import { createHash, randomBytes } from 'node:crypto';

import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { stackOf } from '../../common/logging/app-logger';
import { DAY_MS } from '../../common/paris-time';
import type { BookingStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { shortName } from '../messaging/domain/messaging.rules';
import { UsersService } from '../users/users.service';
import { IcsEvent, icsCalendar } from './domain/ics';

/** A calendar app that fetched within this long still syncs the feed. */
export const FEED_IN_USE_MS = 7 * DAY_MS;
/** `last_fetched_at` is written at most this often: apps poll every few hours. */
const FETCH_STAMP_MS = 60 * 60 * 1000;
/** What the feed carries: a month back, a year ahead. */
const FEED_PAST_MS = 30 * DAY_MS;
const FEED_AHEAD_MS = 365 * DAY_MS;

const STATUS_LABEL: Record<BookingStatus, string> = {
  pending: 'en attente de paiement',
  confirmed: 'confirmée',
  shopping: 'courses en cours',
  cooking: 'en cuisine',
  delivered: 'livrée',
  completed: 'terminée',
  cancelled: 'annulée',
  disputed: 'en litige',
};

const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');

/** Whether the batch cooker's calendar app syncs the feed (`calendarConnected`). */
export const feedInUse = (lastFetchedAt: Date | null | undefined, now = new Date()) =>
  !!lastFetchedAt && now.getTime() - lastFetchedAt.getTime() <= FEED_IN_USE_MS;

const where = (booking: {
  addressLine: string | null;
  addressCity: string | null;
  addressPostalCode: string | null;
}) =>
  booking.addressLine ??
  ([booking.addressPostalCode, booking.addressCity].filter(Boolean).join(' ') || null);

/**
 * The batch cooker's prestations as a calendar feed, and a client's prestation as
 * a file. The feed link is a secret: 32 random bytes, only its SHA-256 stored, so
 * it is shown once and rotating it revokes the old one at once. It carries a
 * client's first name and initial and the address into a third-party calendar.
 */
@Injectable()
export class CalendarFeedService {
  private readonly logger = new Logger(CalendarFeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  async status(clerkUserId: string) {
    const chef = await this.users.chefIdentity(clerkUserId);
    const feed = await this.prisma.chefCalendarFeed.findUnique({
      where: { chefProfileId: chef.chefProfileId },
    });
    return {
      enabled: feed !== null,
      createdAt: feed?.createdAt ?? null,
      rotatedAt: feed?.rotatedAt ?? null,
      lastFetchedAt: feed?.lastFetchedAt ?? null,
      synced: feedInUse(feed?.lastFetchedAt),
    };
  }

  /** Makes the link, or a new one in place of the old. `baseUrl`: this API, public. */
  async issue(clerkUserId: string, baseUrl: string) {
    const chef = await this.users.chefIdentity(clerkUserId);
    const chefProfileId = chef.chefProfileId;
    const token = randomBytes(32).toString('base64url');
    const existing = await this.prisma.chefCalendarFeed.findUnique({
      where: { chefProfileId },
      select: { id: true },
    });
    const feed = await this.prisma.chefCalendarFeed.upsert({
      where: { chefProfileId },
      create: { chefProfileId, tokenHash: hashOf(token) },
      update: { tokenHash: hashOf(token), rotatedAt: new Date(), lastFetchedAt: null },
    });
    this.logger.log({
      event: existing ? 'feed.rotated' : 'feed.created',
      chefProfileId,
    });
    const url = `${baseUrl}/calendar/feed/${token}.ics`;
    return {
      enabled: true,
      // Shown once: only its hash is kept.
      url,
      webcalUrl: url.replace(/^https?:/, 'webcal:'),
      createdAt: feed.createdAt,
      rotatedAt: feed.rotatedAt,
      lastFetchedAt: null,
      synced: false,
    };
  }

  async disable(clerkUserId: string): Promise<void> {
    const chef = await this.users.chefIdentity(clerkUserId);
    const { count } = await this.prisma.chefCalendarFeed.deleteMany({
      where: { chefProfileId: chef.chefProfileId },
    });
    if (count) {
      this.logger.log({ event: 'feed.disabled', chefProfileId: chef.chefProfileId });
    }
  }

  /** The public feed. 404 `FEED_NOT_FOUND` for an unknown or turned-off link alike. */
  async feed(token: string, ip: string): Promise<string> {
    const started = Date.now();
    const feed = await this.prisma.chefCalendarFeed.findUnique({
      where: { tokenHash: hashOf(token) },
      select: { chefProfileId: true },
    });
    if (!feed) {
      // Never the token: a burst of these means someone is guessing.
      this.logger.warn({ event: 'feed.unknown_token', ip });
      throw new NotFoundException({ code: 'FEED_NOT_FOUND', message: 'No such feed.' });
    }
    const chefProfileId = feed.chefProfileId;
    const now = new Date();
    const bookings = await this.prisma.booking.findMany({
      where: {
        chefProfileId,
        status: { not: 'cancelled' },
        startsAt: {
          gte: new Date(now.getTime() - FEED_PAST_MS),
          lte: new Date(now.getTime() + FEED_AHEAD_MS),
        },
      },
      orderBy: { startsAt: 'asc' },
      select: {
        id: true,
        reference: true,
        status: true,
        startsAt: true,
        endsAt: true,
        persons: true,
        addressLine: true,
        addressCity: true,
        addressPostalCode: true,
        client: { select: { fullName: true } },
      },
    });

    // At most one write an hour, whatever the polling pace. Best-effort: the
    // calendar still gets its feed if the stamp fails.
    await this.prisma.chefCalendarFeed
      .updateMany({
        where: {
          chefProfileId,
          OR: [
            { lastFetchedAt: null },
            { lastFetchedAt: { lt: new Date(now.getTime() - FETCH_STAMP_MS) } },
          ],
        },
        data: { lastFetchedAt: now },
      })
      .catch((error: unknown) =>
        this.logger.error({ event: 'feed.stamp_failed', chefProfileId }, stackOf(error)),
      );

    const events: IcsEvent[] = bookings.map((b) => ({
      uid: `${b.id}@labsfood.fr`,
      start: b.startsAt,
      end: b.endsAt,
      summary: `Prestation ${b.reference ?? ''} · ${shortName(b.client.fullName)}`,
      location: where(b),
      description: [
        b.persons ? `${b.persons} personne${b.persons > 1 ? 's' : ''}` : null,
        STATUS_LABEL[b.status],
      ]
        .filter(Boolean)
        .join(' · '),
      status: b.status === 'pending' ? 'TENTATIVE' : 'CONFIRMED',
    }));
    this.logger.debug({
      event: 'feed.served',
      chefProfileId,
      events: events.length,
      ms: Date.now() - started,
    });
    return icsCalendar('Lab’s Food · prestations', events, now);
  }

  /** `GET /me/bookings/:id/calendar.ics`: one prestation, for the client's calendar. */
  async bookingFile(clerkUserId: string, bookingId: string) {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, clientId: user.id },
      select: {
        id: true,
        reference: true,
        status: true,
        startsAt: true,
        endsAt: true,
        persons: true,
        addressLine: true,
        addressCity: true,
        addressPostalCode: true,
        chefProfile: { select: { displayName: true } },
      },
    });
    if (!booking) {
      throw new NotFoundException({
        code: 'BOOKING_NOT_FOUND',
        message: 'Booking not found.',
      });
    }
    return {
      filename: `${booking.reference ?? 'prestation'}.ics`,
      body: icsCalendar('Lab’s Food', [
        {
          uid: `${booking.id}@labsfood.fr`,
          start: booking.startsAt,
          end: booking.endsAt,
          summary: `Batch cooking · ${booking.chefProfile.displayName}`,
          location: where(booking),
          description: [booking.reference, STATUS_LABEL[booking.status]]
            .filter(Boolean)
            .join(' · '),
          status:
            booking.status === 'cancelled'
              ? 'CANCELLED'
              : booking.status === 'pending'
                ? 'TENTATIVE'
                : 'CONFIRMED',
        },
      ]),
    };
  }
}
