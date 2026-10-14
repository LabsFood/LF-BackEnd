import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { open, seal } from '../../common/crypto/secret-box';
import { parisMinute } from '../../common/paris-time';
import type { ChefCalendarConnection } from '../../generated/prisma/client';
import {
  CronofyCalendar,
  CronofyError,
  CronofyService,
  CronofyTokens,
} from '../../integrations/cronofy.service';
import { PrismaService } from '../../prisma/prisma.service';
import { shortName } from '../messaging/domain/messaging.rules';
import { UsersService } from '../users/users.service';
import type { Span } from './domain/availability.rules';
import { signState, verifyState } from './domain/oauth-state';

/** Refresh this long before Cronofy says the access token expires. */
const REFRESH_MARGIN_MS = 60_000;

const writable = (calendar: CronofyCalendar) =>
  !calendar.calendar_readonly && !calendar.calendar_deleted;

/**
 * A batch cooker's calendar, linked through Cronofy: the link itself, the busy
 * time it adds to their availability, and their bookings written into it.
 *
 * The OAuth callback lands on batchcooking-web, which posts `code` and `state`
 * back here with the batch cooker's session: the API has no public callback, and
 * the signed `state` ties the code to the batch cooker who asked for the link.
 *
 * Reading busy time and writing events are best-effort: a Cronofy outage never
 * blocks a booking, it is logged and the calendar is left out until it answers.
 */
@Injectable()
export class CalendarConnectionService {
  private readonly logger = new Logger(CalendarConnectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly cronofy: CronofyService,
  ) {}

  /** Step 1: where to send the batch cooker to agree. */
  async connectUrl(clerkUserId: string) {
    const key = this.ensure();
    const chef = await this.users.chefIdentity(clerkUserId);
    return { url: this.cronofy.authorizeUrl(signState(chef.chefProfileId, key)) };
  }

  /** Step 3: the page Cronofy sent the batch cooker back to hands over the code. */
  async connect(clerkUserId: string, code: string, state: string) {
    const key = this.ensure();
    const chef = await this.users.chefIdentity(clerkUserId);
    if (!verifyState(state, chef.chefProfileId, key)) {
      throw new BadRequestException({
        code: 'INVALID_STATE',
        message:
          'This link expired or was made for someone else. Start again from your agenda.',
      });
    }

    let tokens: CronofyTokens;
    try {
      tokens = await this.cronofy.exchangeCode(code);
    } catch (error) {
      this.logger.warn(`Cronofy refused a code: ${(error as Error).message}`);
      throw new BadRequestException({
        code: 'CALENDAR_CODE_REFUSED',
        message: 'Cronofy did not accept this link. Start again from your agenda.',
      });
    }
    const calendars = await this.cronofy.listCalendars(tokens.access_token);
    const usable = calendars.filter(writable);
    const fields = {
      ...this.sealed(tokens, key),
      cronofySub: tokens.sub,
      providerName: tokens.linking_profile?.provider_name ?? null,
      profileName: tokens.linking_profile?.profile_name ?? null,
      calendarId:
        (usable.find((c) => c.calendar_primary) ?? usable[0])?.calendar_id ?? null,
      status: 'active',
      lastError: null,
    };
    await this.prisma.$transaction([
      this.prisma.chefCalendarConnection.upsert({
        where: { chefProfileId: chef.chefProfileId },
        create: { chefProfileId: chef.chefProfileId, ...fields },
        update: fields,
      }),
      this.prisma.chefProfile.update({
        where: { id: chef.chefProfileId },
        data: { cronofyProfileId: tokens.linking_profile?.profile_id ?? tokens.sub },
      }),
    ]);
    return this.view(chef.chefProfileId, calendars);
  }

  /** Whether the agenda is linked, and the calendars events can go to. */
  async status(clerkUserId: string) {
    const chef = await this.users.chefIdentity(clerkUserId);
    return this.view(chef.chefProfileId);
  }

  /** Which of the linked calendars receives the prestations. */
  async selectCalendar(clerkUserId: string, calendarId: string) {
    this.ensure();
    const chef = await this.users.chefIdentity(clerkUserId);
    const connection = await this.requireActive(chef.chefProfileId);
    const calendars = await this.withToken(connection, (token) =>
      this.cronofy.listCalendars(token),
    );
    if (!calendars.some((c) => c.calendar_id === calendarId && writable(c))) {
      throw new UnprocessableEntityException({
        code: 'CALENDAR_NOT_WRITABLE',
        message: 'Pick one of your calendars that accepts new events.',
      });
    }
    await this.prisma.chefCalendarConnection.update({
      where: { id: connection.id },
      data: { calendarId },
    });
    return this.view(chef.chefProfileId, calendars);
  }

  /** Unlinks the calendar. Events already written stay in it. */
  async disconnect(clerkUserId: string): Promise<void> {
    const chef = await this.users.chefIdentity(clerkUserId);
    const connection = await this.prisma.chefCalendarConnection.findUnique({
      where: { chefProfileId: chef.chefProfileId },
    });
    if (!connection) return;
    if (this.cronofy.configured) {
      try {
        await this.cronofy.revoke(
          open(connection.refreshTokenSealed, this.cronofy.tokenKey!),
        );
      } catch (error) {
        this.logger.warn(
          `Cronofy revoke failed for ${chef.chefProfileId}: ${(error as Error).message}`,
        );
      }
    }
    await this.prisma.$transaction([
      this.prisma.chefCalendarConnection.delete({ where: { id: connection.id } }),
      this.prisma.chefProfile.update({
        where: { id: chef.chefProfileId },
        data: { cronofyProfileId: null },
      }),
    ]);
  }

  /**
   * The batch cooker's busy and tentative time in their calendar. Empty when
   * nothing is linked; a Cronofy failure is logged and counts as empty, so a
   * booking is never blocked by an outage. Our own events are not in it: Cronofy
   * leaves out the events this API wrote.
   *
   * ponytail: asked live on every availability check, no cache. Add a short Redis
   * cache per batch cooker if the latency shows.
   */
  async busy(chefProfileId: string, from: Date, to: Date): Promise<Span[]> {
    if (!this.cronofy.configured) return [];
    const connection = await this.prisma.chefCalendarConnection.findUnique({
      where: { chefProfileId },
    });
    if (connection?.status !== 'active') return [];
    try {
      const blocks = await this.withToken(connection, (token) =>
        this.cronofy.freeBusy(token, from, to),
      );
      return blocks
        .filter(
          (b) => b.free_busy_status === 'busy' || b.free_busy_status === 'tentative',
        )
        .map((b) => ({ start: instant(b.start), end: instant(b.end) }))
        .filter((s) => s.start < to.getTime() && s.end > from.getTime());
    } catch (error) {
      this.logger.error(
        `Calendar busy time unavailable for ${chefProfileId}: ${(error as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Mirrors a booking into its batch cooker's calendar: written while it holds the
   * slot (`pending` included), removed once cancelled. Best-effort and logged.
   *
   * ponytail: no retry queue. Add a BullMQ or Redis retry if sync failures show
   * in the logs.
   */
  async syncBooking(bookingId: string): Promise<void> {
    if (!this.cronofy.configured) return;
    try {
      const booking = await this.prisma.booking.findUnique({
        where: { id: bookingId },
        select: {
          id: true,
          reference: true,
          status: true,
          startsAt: true,
          endsAt: true,
          persons: true,
          addressLine: true,
          cronofyEventId: true,
          chefProfileId: true,
          client: { select: { fullName: true } },
        },
      });
      if (!booking) return;
      const connection = await this.prisma.chefCalendarConnection.findUnique({
        where: { chefProfileId: booking.chefProfileId },
      });
      const calendarId = connection?.calendarId;
      if (connection?.status !== 'active' || !calendarId) return;

      if (booking.status === 'cancelled') {
        if (!booking.cronofyEventId) return;
        const eventId = booking.cronofyEventId;
        await this.withToken(connection, (token) =>
          this.cronofy.deleteEvent(token, calendarId, eventId),
        );
        await this.prisma.booking.update({
          where: { id: booking.id },
          data: { cronofyEventId: null },
        });
        return;
      }

      const who = shortName(booking.client.fullName);
      await this.withToken(connection, (token) =>
        this.cronofy.upsertEvent(token, calendarId, {
          event_id: booking.id,
          summary: ['Prestation', booking.reference, '·', who].filter(Boolean).join(' '),
          description:
            `Lab's Food · ${who}` +
            (booking.persons ? ` · ${booking.persons} pers.` : '') +
            (booking.status === 'pending' ? ' · en attente de paiement' : ''),
          start: booking.startsAt.toISOString(),
          end: booking.endsAt.toISOString(),
          ...(booking.addressLine && { location: { description: booking.addressLine } }),
        }),
      );
      if (booking.cronofyEventId !== booking.id) {
        await this.prisma.booking.update({
          where: { id: booking.id },
          data: { cronofyEventId: booking.id },
        });
      }
    } catch (error) {
      this.logger.error(
        `Calendar sync failed for booking ${bookingId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private ensure(): Buffer {
    if (!this.cronofy.configured) {
      throw new ServiceUnavailableException({
        code: 'CALENDAR_UNAVAILABLE',
        message:
          'Calendar linking is not configured on this server (CRONOFY_* variables).',
      });
    }
    return this.cronofy.tokenKey!;
  }

  private sealed(tokens: CronofyTokens, key: Buffer) {
    return {
      accessTokenSealed: seal(tokens.access_token, key),
      refreshTokenSealed: seal(tokens.refresh_token, key),
      accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    };
  }

  private async requireActive(chefProfileId: string) {
    const connection = await this.prisma.chefCalendarConnection.findUnique({
      where: { chefProfileId },
    });
    if (connection?.status !== 'active') {
      throw new NotFoundException({
        code: 'CALENDAR_NOT_CONNECTED',
        message: 'No calendar is linked. Connect one from your agenda.',
      });
    }
    return connection;
  }

  private async view(chefProfileId: string, calendars?: CronofyCalendar[]) {
    const connection = await this.prisma.chefCalendarConnection.findUnique({
      where: { chefProfileId },
    });
    if (!connection) {
      return { configured: this.cronofy.configured, connected: false as const };
    }
    let listed = calendars;
    if (!listed && connection.status === 'active' && this.cronofy.configured) {
      listed = await this.withToken(connection, (token) =>
        this.cronofy.listCalendars(token),
      ).catch(() => undefined);
    }
    return {
      configured: this.cronofy.configured,
      connected: true as const,
      status: connection.status,
      providerName: connection.providerName,
      profileName: connection.profileName,
      calendarId: connection.calendarId,
      lastError: connection.lastError,
      calendars: (listed ?? []).filter(writable).map((c) => ({
        id: c.calendar_id,
        name: c.calendar_name,
        primary: c.calendar_primary,
        provider: c.provider_name,
        profile: c.profile_name,
      })),
    };
  }

  /** Runs `work` with a fresh access token, refreshing once more after a 401. */
  private async withToken<T>(
    connection: ChefCalendarConnection,
    work: (token: string) => Promise<T>,
  ): Promise<T> {
    const key = this.cronofy.tokenKey!;
    const fresh =
      connection.accessTokenExpiresAt.getTime() - REFRESH_MARGIN_MS > Date.now();
    const token = fresh
      ? open(connection.accessTokenSealed, key)
      : await this.refreshed(connection);
    try {
      return await work(token);
    } catch (error) {
      if (!(error instanceof CronofyError) || error.status !== 401) throw error;
      return work(await this.refreshed(connection));
    }
  }

  /**
   * A new access token. A grant Cronofy no longer knows marks the link `revoked`,
   * unless another request rotated the tokens meanwhile.
   *
   * ponytail: no lock on concurrent refreshes; a race is settled by re-reading the
   * row. Add a Redis lock per batch cooker if `revoked` shows up wrongly.
   */
  private async refreshed(connection: ChefCalendarConnection): Promise<string> {
    const key = this.cronofy.tokenKey!;
    try {
      const tokens = await this.cronofy.refresh(open(connection.refreshTokenSealed, key));
      await this.prisma.chefCalendarConnection.update({
        where: { id: connection.id },
        data: { ...this.sealed(tokens, key), lastError: null },
      });
      return tokens.access_token;
    } catch (error) {
      if (error instanceof CronofyError && error.invalidGrant) {
        const latest = await this.prisma.chefCalendarConnection.findUnique({
          where: { id: connection.id },
        });
        if (latest && latest.refreshTokenSealed !== connection.refreshTokenSealed) {
          return open(latest.accessTokenSealed, key);
        }
        await this.prisma.chefCalendarConnection.updateMany({
          where: { id: connection.id, refreshTokenSealed: connection.refreshTokenSealed },
          data: {
            status: 'revoked',
            lastError: 'The calendar access was withdrawn or expired: connect it again.',
          },
        });
      }
      throw error;
    }
  }
}

/** A Cronofy time, or an all-day date read as Paris midnight. */
function instant(value: string): number {
  return value.length === 10
    ? parisMinute(new Date(value), 0).getTime()
    : Date.parse(value);
}
