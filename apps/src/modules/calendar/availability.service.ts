import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { DAY_MS, parisToday, ymd } from '../../common/paris-time';
import { PrismaService } from '../../prisma/prisma.service';
import { HOLDS_SLOT } from '../bookings/domain/booking-status';
import { UsersService } from '../users/users.service';
import {
  DayException,
  MAX_WINDOW_DAYS,
  Span,
  hasOverlap,
  isBookable,
  startTimes,
  subtract,
  workingSpans,
} from './domain/availability.rules';
import {
  ChefSlotsQueryDto,
  PublicSlotsQueryDto,
  ScheduleDto,
} from './dto/availability.dto';

const invalid = (message: string) =>
  new UnprocessableEntityException({ code: 'VALIDATION_FAILED', message });

/**
 * When a batch cooker can take a prestation: their working hours (a weekly
 * template and dated exceptions, as batchcooking-web's agenda edits them), minus
 * every booking that holds their time.
 *
 * A batch cooker who never set working hours is `scheduled: false`: no slot is
 * offered, and a booking is checked against the rest only, as the vitrine already
 * shows them "on request".
 */
@Injectable()
export class AvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  async schedule(clerkUserId: string) {
    const chef = await this.users.chefIdentity(clerkUserId);
    return this.scheduleOf(chef.chefProfileId);
  }

  /** Replaces the whole schedule: what the agenda sends is what stands. */
  async replaceSchedule(clerkUserId: string, dto: ScheduleDto) {
    const chef = await this.users.chefIdentity(clerkUserId);
    const extras = dto.exceptions.filter((e) => e.kind === 'extra');
    for (const range of [...dto.weekly, ...extras]) {
      if (range.startMinute! >= range.endMinute!) {
        throw invalid('Each range must end after it starts.');
      }
    }
    if (
      hasOverlap(
        dto.weekly.map((s) => ({
          key: `${s.weekday}`,
          start: s.startMinute,
          end: s.endMinute,
        })),
      ) ||
      hasOverlap(
        extras.map((e) => ({ key: e.date, start: e.startMinute!, end: e.endMinute! })),
      )
    ) {
      throw invalid('Two ranges of the same day overlap.');
    }

    const chefProfileId = chef.chefProfileId;
    await this.prisma.$transaction([
      this.prisma.chefWorkingHour.deleteMany({ where: { chefProfileId } }),
      this.prisma.chefAvailabilityException.deleteMany({ where: { chefProfileId } }),
      this.prisma.chefWorkingHour.createMany({
        data: dto.weekly.map((s) => ({ chefProfileId, ...s })),
      }),
      this.prisma.chefAvailabilityException.createMany({
        data: dto.exceptions.map((e) => ({
          chefProfileId,
          date: new Date(`${e.date}T00:00:00.000Z`),
          kind: e.kind,
          startMinute: e.kind === 'extra' ? e.startMinute! : null,
          endMinute: e.kind === 'extra' ? e.endMinute! : null,
          reason: e.reason ?? null,
        })),
      }),
    ]);
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

  /** The public booking page: free start times for one service offer. */
  async publicSlots(chefProfileId: string, query: PublicSlotsQueryDto) {
    const offer = await this.prisma.serviceOffer.findFirst({
      where: {
        id: query.offerId,
        chefProfileId,
        isActive: true,
        chefProfile: { isActive: true, isVerified: true },
      },
      select: { durationMinutes: true },
    });
    if (!offer) {
      throw new NotFoundException({
        code: 'OFFER_NOT_FOUND',
        message: 'Offer not found.',
      });
    }
    return {
      durationMinutes: offer.durationMinutes,
      ...(await this.freeSlots(
        chefProfileId,
        query.from,
        query.to,
        offer.durationMinutes,
      )),
    };
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
      throw new ConflictException({
        code: 'SLOT_UNAVAILABLE',
        message: 'The batch cooker is not available at this time.',
      });
    }
  }

  private async busy(
    chefProfileId: string,
    from: Date,
    to: Date,
    ignoreBookingId?: string,
  ): Promise<Span[]> {
    const bookings = await this.prisma.booking.findMany({
      where: {
        chefProfileId,
        status: { in: [...HOLDS_SLOT] },
        startsAt: { lt: to },
        endsAt: { gt: from },
        ...(ignoreBookingId && { id: { not: ignoreBookingId } }),
      },
      select: { startsAt: true, endsAt: true },
    });
    return bookings.map((b) => ({
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

  private async scheduleOf(chefProfileId: string) {
    const [weekly, exceptions] = await Promise.all([
      this.prisma.chefWorkingHour.findMany({
        where: { chefProfileId },
        orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
      }),
      this.prisma.chefAvailabilityException.findMany({
        where: { chefProfileId, date: { gte: parisToday() } },
        orderBy: [{ date: 'asc' }, { startMinute: 'asc' }],
      }),
    ]);
    return {
      weekly: weekly.map((s) => ({
        weekday: s.weekday,
        startMinute: s.startMinute,
        endMinute: s.endMinute,
      })),
      exceptions: exceptions.map((e) => ({
        date: ymd(e.date),
        kind: e.kind,
        startMinute: e.startMinute,
        endMinute: e.endMinute,
        reason: e.reason,
      })),
    };
  }
}
