import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { DAY_MS, parisToday, ymd } from '../../common/paris-time';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { HOLDS_SLOT } from '../bookings/domain/booking-status';
import { UsersService } from '../users/users.service';
import {
  DayException,
  MAX_WINDOW_DAYS,
  Span,
  WeeklySlot,
  firstOverlap,
  isBookable,
  scheduleVersion,
  startTimes,
  subtract,
  workingSpans,
} from './domain/availability.rules';
import {
  AvailabilityExceptionDto,
  ChefSlotsQueryDto,
  PublicSlotsQueryDto,
  ScheduleDto,
} from './dto/availability.dto';

export const invalid = (
  message: string,
  code = 'VALIDATION_FAILED',
  details?: Record<string, unknown>,
) => new UnprocessableEntityException({ code, message, ...(details && { details }) });

type Db = PrismaService | Prisma.TransactionClient;

/**
 * When a batch cooker can take a prestation: their working hours (a weekly
 * template and dated exceptions, as batchcooking-web's agenda edits them), minus
 * every booking that holds their time and the blocks they set themselves.
 *
 * A batch cooker who never set working hours is `scheduled: false`: no slot is
 * offered, and a booking is checked against the rest only, as the vitrine already
 * shows them "on request".
 */
@Injectable()
export class AvailabilityService {
  private readonly logger = new Logger(AvailabilityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  async schedule(clerkUserId: string) {
    const chef = await this.users.chefIdentity(clerkUserId);
    return this.scheduleOf(chef.chefProfileId);
  }

  /**
   * Replaces the weekly template and the exceptions from today on: what the agenda
   * sends is what stands. Past exceptions are kept, so past months still show
   * their days off, and any sent again are ignored.
   *
   * With `version`, a save from a stale tab is refused (409 `SCHEDULE_CHANGED`)
   * instead of erasing what another tab saved. Saves of one batch cooker are
   * serialised on their profile row, so the check cannot race.
   */
  async replaceSchedule(clerkUserId: string, dto: ScheduleDto) {
    const chef = await this.users.chefIdentity(clerkUserId);
    const chefProfileId = chef.chefProfileId;
    const today = parisToday();
    const ahead = dto.exceptions.filter((e) => e.date >= ymd(today));
    assertValidSchedule(dto.weekly, ahead);

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM chef_profiles WHERE id = ${chefProfileId}::uuid FOR UPDATE`;
      if (dto.version !== undefined) {
        const current = await readSchedule(tx, chefProfileId, today);
        if (current.version !== dto.version) {
          throw new ConflictException({
            code: 'SCHEDULE_CHANGED',
            message:
              'Your hours were changed elsewhere meanwhile. Reload them, then save.',
          });
        }
      }
      await tx.chefWorkingHour.deleteMany({ where: { chefProfileId } });
      await tx.chefAvailabilityException.deleteMany({
        where: { chefProfileId, date: { gte: today } },
      });
      await tx.chefWorkingHour.createMany({
        data: dto.weekly.map((s) => ({
          chefProfileId,
          weekday: s.weekday,
          startMinute: s.startMinute,
          endMinute: s.endMinute,
        })),
      });
      await tx.chefAvailabilityException.createMany({
        data: ahead.map((e) => ({
          chefProfileId,
          date: new Date(`${e.date}T00:00:00.000Z`),
          kind: e.kind,
          startMinute: e.kind === 'extra' ? e.startMinute! : null,
          endMinute: e.kind === 'extra' ? e.endMinute! : null,
          reason: e.reason ?? null,
        })),
      });
    });
    this.logger.log({
      event: 'schedule.replaced',
      chefProfileId,
      weekly: dto.weekly.length,
      exceptions: ahead.length,
    });
    return this.scheduleOf(chefProfileId);
  }

  async chefSlots(clerkUserId: string, query: ChefSlotsQueryDto) {
    const chef = await this.users.chefIdentity(clerkUserId);
    return this.freeSlots(
      chef.chefProfileId,
      query.from,
      query.to,
      query.durationMinutes,
    );
  }

  /**
   * The public booking page: free start times for one service offer. Without
   * `offerId`, the batch cooker's most expensive active offer (the shorter one on a
   * tie, then the older), named in the answer so the page can book it.
   */
  async publicSlots(chefProfileId: string, query: PublicSlotsQueryDto) {
    const started = Date.now();
    const offer = await this.prisma.serviceOffer.findFirst({
      where: {
        ...(query.offerId && { id: query.offerId }),
        chefProfileId,
        isActive: true,
        chefProfile: { isActive: true, isVerified: true },
      },
      orderBy: [{ priceCents: 'desc' }, { durationMinutes: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, durationMinutes: true, priceCents: true },
    });
    if (!offer) {
      throw new NotFoundException({
        code: 'OFFER_NOT_FOUND',
        message: 'Offer not found.',
      });
    }
    const free = await this.freeSlots(
      chefProfileId,
      query.from,
      query.to,
      offer.durationMinutes,
    );
    // Public and throttled: debug, not info.
    this.logger.debug({
      event: 'availability.public_read',
      chefProfileId,
      defaultOffer: !query.offerId,
      slots: free.slots.length,
      ms: Date.now() - started,
    });
    return { offer, durationMinutes: offer.durationMinutes, ...free };
  }

  /**
   * "N créneaux libres" on the public cards: whole sessions left between `from` and
   * `to`, a session lasting as long as the batch cooker's shortest active offer.
   * 5 h free with a 2 h 30 offer is 2; 4 h is 1. Only what is still ahead counts.
   *
   * Null ("sur demande") without working hours or without an active offer. A
   * batch cooker is scheduled as soon as they set any hours, as `assertBookable`
   * reads it. One query per table for all the batch cookers on the page.
   */
  async slotsLeftFor(
    chefProfileIds: string[],
    from: Date,
    to: Date,
  ): Promise<Map<string, number | null>> {
    const left = new Map<string, number | null>();
    if (chefProfileIds.length === 0) return left;
    const start = new Date(Math.max(from.getTime(), Date.now()));
    const ids = { in: chefProfileIds };
    const overlapping = {
      chefProfileId: ids,
      startsAt: { lt: to },
      endsAt: { gt: start },
    };
    const [templates, exceptions, everExcepted, bookings, blocks, offers] =
      await Promise.all([
        this.prisma.chefWorkingHour.findMany({ where: { chefProfileId: ids } }),
        this.prisma.chefAvailabilityException.findMany({
          where: {
            chefProfileId: ids,
            date: { gte: parisToday(start), lte: parisToday(to) },
          },
        }),
        this.prisma.chefAvailabilityException.groupBy({
          by: ['chefProfileId'],
          where: { chefProfileId: ids },
        }),
        this.prisma.booking.findMany({
          where: { ...overlapping, status: { in: [...HOLDS_SLOT] } },
          select: { chefProfileId: true, startsAt: true, endsAt: true },
        }),
        this.prisma.chefTimeBlock.findMany({
          where: overlapping,
          select: { chefProfileId: true, startsAt: true, endsAt: true },
        }),
        this.prisma.serviceOffer.groupBy({
          by: ['chefProfileId'],
          where: { chefProfileId: ids, isActive: true },
          _min: { durationMinutes: true },
        }),
      ]);

    const scheduled = new Set([
      ...templates.map((t) => t.chefProfileId),
      ...everExcepted.map((e) => e.chefProfileId),
    ]);
    const mine = <T extends { chefProfileId: string }>(rows: T[], id: string) =>
      rows.filter((row) => row.chefProfileId === id);
    for (const id of chefProfileIds) {
      const minutes = offers.find((o) => o.chefProfileId === id)?._min.durationMinutes;
      if (!scheduled.has(id) || !minutes) {
        left.set(id, null);
        continue;
      }
      const free = subtract(
        workingSpans(
          mine(templates, id),
          mine(exceptions, id) as DayException[],
          start,
          to,
        ),
        [...mine(bookings, id), ...mine(blocks, id)].map((b) => ({
          start: b.startsAt.getTime(),
          end: b.endsAt.getTime(),
        })),
      );
      left.set(
        id,
        free.reduce(
          (sessions, span) =>
            sessions + Math.floor((span.end - span.start) / (minutes * 60_000)),
          0,
        ),
      );
    }
    return left;
  }

  async freeSlots(chefProfileId: string, from: Date, to: Date, durationMinutes: number) {
    const start = new Date(Math.max(from.getTime(), Date.now()));
    if (to.getTime() <= start.getTime())
      throw invalid('`to` must be after `from` and now.');
    if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * DAY_MS) {
      throw invalid(`Ask for ${MAX_WINDOW_DAYS} days at most.`);
    }
    const { template, exceptions, scheduled } = await this.load(chefProfileId, start, to);
    if (!scheduled) return { scheduled: false, slots: [] as Date[] };
    const free = subtract(
      workingSpans(template, exceptions, start, to),
      await this.busy(chefProfileId, start, to),
    );
    return { scheduled: true, slots: startTimes(free, durationMinutes * 60_000) };
  }

  /** 409 `SLOT_UNAVAILABLE` unless the batch cooker is free for the whole range. */
  async assertBookable(
    chefProfileId: string,
    startsAt: Date,
    endsAt: Date,
    ignoreBookingId?: string,
  ): Promise<void> {
    const wanted: Span = { start: startsAt.getTime(), end: endsAt.getTime() };
    const { template, exceptions, scheduled } = await this.load(
      chefProfileId,
      startsAt,
      endsAt,
    );
    const working = scheduled
      ? workingSpans(template, exceptions, startsAt, endsAt)
      : [wanted];
    const busy = await this.busy(chefProfileId, startsAt, endsAt, ignoreBookingId);
    if (!isBookable(working, busy, wanted)) {
      this.logger.log({
        event: 'availability.refused',
        chefProfileId,
        code: 'SLOT_UNAVAILABLE',
        scheduled,
      });
      throw new ConflictException({
        code: 'SLOT_UNAVAILABLE',
        message: 'The batch cooker is not available at this time.',
      });
    }
  }

  /**
   * 409 `CHEF_CLOSED_ON_DATE` when the batch cooker took that whole day off. A
   * closed day is never shown as available, so a request for it is refused. Only
   * the day is checked: a request is a half-day the batch cooker answers.
   */
  async assertOpenOn(chefProfileId: string, day: Date): Promise<void> {
    const closed = await this.prisma.chefAvailabilityException.findFirst({
      where: { chefProfileId, date: day, kind: 'closed' },
      select: { id: true },
    });
    if (closed) {
      this.logger.log({
        event: 'availability.refused',
        chefProfileId,
        code: 'CHEF_CLOSED_ON_DATE',
      });
      throw new ConflictException({
        code: 'CHEF_CLOSED_ON_DATE',
        message: 'The batch cooker does not work that day.',
      });
    }
  }

  /** The weekly template and the exceptions from today on, with ids and `version`. */
  scheduleOf(chefProfileId: string) {
    return readSchedule(this.prisma, chefProfileId, parisToday());
  }

  private async busy(
    chefProfileId: string,
    from: Date,
    to: Date,
    ignoreBookingId?: string,
  ): Promise<Span[]> {
    const overlapping = { chefProfileId, startsAt: { lt: to }, endsAt: { gt: from } };
    const [bookings, blocks] = await Promise.all([
      this.prisma.booking.findMany({
        where: {
          ...overlapping,
          status: { in: [...HOLDS_SLOT] },
          ...(ignoreBookingId && { id: { not: ignoreBookingId } }),
        },
        select: { startsAt: true, endsAt: true },
      }),
      this.prisma.chefTimeBlock.findMany({
        where: overlapping,
        select: { startsAt: true, endsAt: true },
      }),
    ]);
    return [...bookings, ...blocks].map((b) => ({
      start: b.startsAt.getTime(),
      end: b.endsAt.getTime(),
    }));
  }

  private async load(chefProfileId: string, from: Date, to: Date) {
    const [template, exceptions] = await Promise.all([
      this.prisma.chefWorkingHour.findMany({ where: { chefProfileId } }),
      this.prisma.chefAvailabilityException.findMany({
        where: { chefProfileId, date: { gte: parisToday(from), lte: parisToday(to) } },
      }),
    ]);
    const scheduled =
      template.length > 0 ||
      exceptions.length > 0 ||
      (await this.prisma.chefAvailabilityException.count({ where: { chefProfileId } })) >
        0;
    return { template, exceptions: exceptions as DayException[], scheduled };
  }
}

/** An exception as the agenda edits it: the date as `YYYY-MM-DD`. */
export const toExceptionView = (e: {
  id: string;
  date: Date;
  kind: string;
  startMinute: number | null;
  endMinute: number | null;
  reason: string | null;
}) => ({
  id: e.id,
  date: ymd(e.date),
  kind: e.kind,
  startMinute: e.startMinute,
  endMinute: e.endMinute,
  reason: e.reason,
});

async function readSchedule(db: Db, chefProfileId: string, today: Date) {
  const [weekly, exceptions] = await Promise.all([
    db.chefWorkingHour.findMany({
      where: { chefProfileId },
      orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
      select: { id: true, weekday: true, startMinute: true, endMinute: true },
    }),
    db.chefAvailabilityException.findMany({
      where: { chefProfileId, date: { gte: today } },
      orderBy: [{ date: 'asc' }, { startMinute: 'asc' }],
    }),
  ]);
  const views = exceptions.map(toExceptionView);
  return {
    weekly,
    exceptions: views,
    version: scheduleVersion(weekly, views),
    scheduled: weekly.length > 0 || views.length > 0,
  };
}

/**
 * Refusals name the day, so the page can point at it: `details.weekday` (0 is
 * Monday) for the weekly template, `details.date` for an exception.
 */
function assertValidSchedule(
  weekly: WeeklySlot[],
  exceptions: AvailabilityExceptionDto[],
): void {
  const extras = exceptions.filter((e) => e.kind === 'extra');
  const badWeekly = weekly.find((s) => s.startMinute >= s.endMinute);
  if (badWeekly) {
    throw invalid('Each range must end after it starts.', 'RANGE_INVALID', {
      weekday: badWeekly.weekday,
    });
  }
  const badExtra = extras.find((e) => e.startMinute! >= e.endMinute!);
  if (badExtra) {
    throw invalid('Each range must end after it starts.', 'RANGE_INVALID', {
      date: badExtra.date,
    });
  }
  const closedDays = new Set(
    exceptions.filter((e) => e.kind === 'closed').map((e) => e.date),
  );
  const conflict = extras.find((e) => closedDays.has(e.date));
  if (conflict) {
    throw invalid(
      'A closed day cannot have extra hours: remove one or the other.',
      'SCHEDULE_CONFLICT',
      { date: conflict.date },
    );
  }
  const weekday = firstOverlap(
    weekly.map((s) => ({ key: `${s.weekday}`, start: s.startMinute, end: s.endMinute })),
  );
  if (weekday !== null) {
    throw invalid('Two ranges of the same day overlap.', 'SCHEDULE_OVERLAP', {
      weekday: Number(weekday),
    });
  }
  const date = firstOverlap(
    extras.map((e) => ({ key: e.date, start: e.startMinute!, end: e.endMinute! })),
  );
  if (date !== null) {
    throw invalid('Two ranges of the same day overlap.', 'SCHEDULE_OVERLAP', { date });
  }
}
