import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { DAY_MS, parisMinute, parisToday } from '../../common/paris-time';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { HOLDS_SLOT } from '../bookings/domain/booking-status';
import { shortName } from '../messaging/domain/messaging.rules';
import {
  ACTIVE_OFFER,
  AWAITING_CHEF,
  TIME_SLOT_KEYS,
  TimeSlot,
  slotWindow,
} from '../quotes/domain/quote.rules';
import { UsersService } from '../users/users.service';
import { AvailabilityService, invalid, toExceptionView } from './availability.service';
import { MAX_AGENDA_DAYS } from './domain/availability.rules';
import { AgendaQueryDto, TimeBlockDto } from './dto/availability.dto';

/** Blocks ahead a batch cooker may hold: past that it is a misuse, not an agenda. */
export const MAX_BLOCKS_AHEAD = 200;

const BLOCK_SELECT = { id: true, startsAt: true, endsAt: true, reason: true } as const;

/**
 * The batch cooker's agenda, as batchcooking-web draws it: one read for the day,
 * week and month views, a count per month for the year view, and the blocks the
 * batch cooker sets themselves.
 */
@Injectable()
export class AgendaService {
  private readonly logger = new Logger(AgendaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly availability: AvailabilityService,
  ) {}

  /**
   * Everything between `from` and `to` (42 days at most, past included):
   * - the schedule, with the exceptions of the window
   * - the prestations, cancelled ones left out
   * - the requests assigned to this batch cooker, at the time the active offer
   *   proposes, else the time asked
   * - the blocks
   */
  async read(clerkUserId: string, { from, to }: AgendaQueryDto) {
    const started = Date.now();
    const chef = await this.users.chefIdentity(clerkUserId);
    if (to.getTime() <= from.getTime()) throw invalid('`to` must be after `from`.');
    if (to.getTime() - from.getTime() > MAX_AGENDA_DAYS * DAY_MS) {
      throw invalid(`Ask for ${MAX_AGENDA_DAYS} days at most.`);
    }
    const chefProfileId = chef.chefProfileId;
    const overlapping = { chefProfileId, startsAt: { lt: to }, endsAt: { gt: from } };

    const [schedule, exceptions, bookings, quotes, blocks] = await Promise.all([
      this.availability.scheduleOf(chefProfileId),
      this.prisma.chefAvailabilityException.findMany({
        where: { chefProfileId, date: { gte: parisToday(from), lte: parisToday(to) } },
        orderBy: [{ date: 'asc' }, { startMinute: 'asc' }],
      }),
      this.prisma.booking.findMany({
        where: { ...overlapping, status: { not: 'cancelled' } },
        orderBy: { startsAt: 'asc' },
        select: {
          id: true,
          reference: true,
          status: true,
          startsAt: true,
          endsAt: true,
          timeSlot: true,
          persons: true,
          addressCity: true,
          client: { select: { fullName: true } },
          // D3: a new time waiting for an answer, drawn as a target.
          reschedules: {
            where: { status: 'pending' },
            take: 1,
            select: { toStartsAt: true },
          },
        },
      }),
      this.prisma.quote.findMany({
        where: {
          assignedChefUserId: chef.userId,
          status: { in: [...AWAITING_CHEF, 'quoted'] },
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          reference: true,
          title: true,
          status: true,
          persons: true,
          addressCity: true,
          desiredDate: true,
          timeSlot: true,
          client: { select: { fullName: true } },
          offers: {
            where: { status: { in: [...ACTIVE_OFFER] } },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { proposedDate: true, proposedTimeSlot: true },
          },
        },
      }),
      this.prisma.chefTimeBlock.findMany({
        where: overlapping,
        orderBy: { startsAt: 'asc' },
        select: BLOCK_SELECT,
      }),
    ]);

    const requests = quotes
      .map((quote) => {
        const offer = quote.offers[0];
        const window = requestWindow(
          offer?.proposedDate ?? quote.desiredDate,
          offer?.proposedTimeSlot ?? quote.timeSlot,
        );
        return {
          id: quote.id,
          reference: quote.reference,
          title: quote.title,
          stage: quote.status === 'quoted' ? 'offer_sent' : 'to_answer',
          persons: quote.persons,
          city: quote.addressCity,
          client: { name: shortName(quote.client.fullName) },
          startsAt: window?.startsAt ?? null,
          endsAt: window?.endsAt ?? null,
        };
      })
      // A request without a date is kept: the page lists it beside the calendar.
      .filter(
        (r) =>
          r.startsAt === null ||
          (r.startsAt.getTime() < to.getTime() && r.endsAt!.getTime() > from.getTime()),
      );

    this.logger.debug({
      event: 'agenda.read',
      chefProfileId,
      days: Math.round((to.getTime() - from.getTime()) / DAY_MS),
      prestations: bookings.length,
      requests: requests.length,
      blocks: blocks.length,
      ms: Date.now() - started,
    });
    return {
      scheduled: schedule.scheduled,
      schedule: {
        weekly: schedule.weekly,
        exceptions: exceptions.map(toExceptionView),
        version: schedule.version,
      },
      prestations: bookings.map((b) => ({
        id: b.id,
        reference: b.reference,
        status: b.status,
        startsAt: b.startsAt,
        endsAt: b.endsAt,
        timeSlot: b.timeSlot,
        persons: b.persons,
        city: b.addressCity,
        client: { name: shortName(b.client.fullName) },
        rescheduleTo: b.reschedules[0]?.toStartsAt ?? null,
      })),
      requests,
      blocks,
    };
  }

  /**
   * The year view: prestations (cancelled ones aside) per month of their start,
   * Paris time.
   *
   * ponytail: counted in memory from one query for the year. A batch cooker has a
   * few hundred bookings a year at most; group in SQL (`date_trunc`) if that grows.
   */
  async summary(clerkUserId: string, year: number) {
    const chef = await this.users.chefIdentity(clerkUserId);
    const rows = await this.prisma.booking.findMany({
      where: {
        chefProfileId: chef.chefProfileId,
        status: { not: 'cancelled' },
        startsAt: {
          gte: parisMinute(new Date(Date.UTC(year, 0, 1)), 0),
          lt: parisMinute(new Date(Date.UTC(year + 1, 0, 1)), 0),
        },
      },
      select: { startsAt: true },
    });
    const months = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      prestations: 0,
    }));
    for (const { startsAt } of rows) {
      months[parisToday(startsAt).getUTCMonth()].prestations += 1;
    }
    return { year, months };
  }

  /**
   * Blocks the batch cooker's time: busy for bookings from now on. The same block
   * sent twice returns the first, so a double click makes one.
   */
  async addBlock(clerkUserId: string, dto: TimeBlockDto) {
    const chef = await this.users.chefIdentity(clerkUserId);
    const chefProfileId = chef.chefProfileId;
    const { startsAt, endsAt } = dto;
    const now = Date.now();
    if (endsAt.getTime() <= startsAt.getTime()) {
      throw invalid('A block must end after it starts.', 'RANGE_INVALID');
    }
    if (endsAt.getTime() <= now) throw invalid('A block must end in the future.');
    if (endsAt.getTime() - startsAt.getTime() > MAX_AGENDA_DAYS * DAY_MS) {
      throw invalid(`A block lasts ${MAX_AGENDA_DAYS} days at most.`);
    }

    const same = () =>
      this.prisma.chefTimeBlock.findFirst({
        where: { chefProfileId, startsAt, endsAt },
        select: BLOCK_SELECT,
      });
    const existing = await same();
    if (existing) return existing;

    const [taken, ahead] = await Promise.all([
      this.prisma.booking.count({
        where: {
          chefProfileId,
          status: { in: [...HOLDS_SLOT] },
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
        },
      }),
      this.prisma.chefTimeBlock.count({
        where: { chefProfileId, endsAt: { gt: new Date(now) } },
      }),
    ]);
    // ponytail: no lock against a booking made in the same instant; both would
    // stand, and the batch cooker sees the overlap in the agenda. Lock the chef
    // profile row, as schedule saves do, if that ever happens.
    if (taken > 0) {
      throw new ConflictException({
        code: 'BLOCK_OVERLAPS_BOOKING',
        message: 'A prestation holds this time. Cancel or move it first.',
      });
    }
    if (ahead >= MAX_BLOCKS_AHEAD) {
      throw new ConflictException({
        code: 'TOO_MANY_BLOCKS',
        message: `${MAX_BLOCKS_AHEAD} blocks ahead at most. Remove some first.`,
      });
    }

    try {
      const block = await this.prisma.chefTimeBlock.create({
        data: { chefProfileId, startsAt, endsAt, reason: dto.reason ?? null },
        select: BLOCK_SELECT,
      });
      // The reason is the batch cooker's own words: never logged.
      this.logger.log({ event: 'block.created', chefProfileId, blockId: block.id });
      return block;
    } catch (error) {
      // The same block, created by a second click meanwhile.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await same();
        if (raced) return raced;
      }
      throw error;
    }
  }

  async removeBlock(clerkUserId: string, blockId: string): Promise<void> {
    const chef = await this.users.chefIdentity(clerkUserId);
    const { count } = await this.prisma.chefTimeBlock.deleteMany({
      where: { id: blockId, chefProfileId: chef.chefProfileId },
    });
    if (count === 0) {
      throw new NotFoundException({
        code: 'BLOCK_NOT_FOUND',
        message: 'Block not found.',
      });
    }
    this.logger.log({
      event: 'block.deleted',
      chefProfileId: chef.chefProfileId,
      blockId,
    });
  }
}

/**
 * When a request takes place: its half-day on that date, or the whole day when
 * the request names none. Null without a date.
 */
function requestWindow(day: Date | null, slot: string | null) {
  if (!day) return null;
  if (slot && TIME_SLOT_KEYS.includes(slot as TimeSlot)) {
    const { startsAt, endsAt } = slotWindow(day, slot as TimeSlot);
    return { startsAt, endsAt };
  }
  return {
    startsAt: parisMinute(day, 0),
    endsAt: parisMinute(new Date(day.getTime() + DAY_MS), 0),
  };
}
