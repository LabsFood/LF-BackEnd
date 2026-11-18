import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SentryCron } from '@sentry/nestjs';

import { stackOf } from '../../common/logging/app-logger';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AvailabilityService } from '../calendar/availability.service';
import { changedMeanwhile } from '../dishes/dishes.service';
import { shortName } from '../messaging/domain/messaging.rules';
import { UsersService } from '../users/users.service';
import { BookingsMailer } from './bookings.mailer';
import { schedule } from './bookings.service';
import { RESCHEDULE_VIEW, RescheduleRow, toRescheduleView } from './bookings.views';
import {
  RescheduleDecision,
  RescheduleSide,
  canReschedule,
  decisionRefusal,
  rescheduleExpiry,
} from './domain/reschedule.rules';

/** What a proposal needs of its booking: the time, and who to tell. */
const BOOKING_SELECT = {
  id: true,
  reference: true,
  status: true,
  chefProfileId: true,
  startsAt: true,
  endsAt: true,
  client: { select: { email: true, fullName: true } },
  chefProfile: {
    select: { displayName: true, user: { select: { email: true, fullName: true } } },
  },
} as const;

type Booking = Prisma.BookingGetPayload<{ select: typeof BOOKING_SELECT }>;

const notFound = () =>
  new NotFoundException({ code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' });

const notReschedulable = () =>
  new ConflictException({
    code: 'BOOKING_NOT_RESCHEDULABLE',
    message:
      'Only a confirmed prestation more than 48 h away can move, to a time more than 48 h away.',
  });

/**
 * Moving a confirmed prestation: one side proposes a new start, the other confirms
 * it. The duration, price and payments stay. Nothing moves inside the last 48 h;
 * the other side has 48 h to answer, cut short to 48 h before the start. The new
 * time is checked when proposed and again when confirmed, and not held meanwhile.
 * An admin moves a booking directly with `PATCH /admin/bookings/:id`.
 */
@Injectable()
export class BookingReschedulesService {
  private readonly logger = new Logger(BookingReschedulesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly availability: AvailabilityService,
    private readonly mailer: BookingsMailer,
  ) {}

  async propose(
    side: RescheduleSide,
    clerkUserId: string,
    bookingId: string,
    startsAt: Date,
  ) {
    const { userId, booking } = await this.load(side, clerkUserId, bookingId);
    const now = new Date();
    if (!canReschedule(booking.status, booking.startsAt, startsAt, now)) {
      throw notReschedulable();
    }
    if (startsAt.getTime() === booking.startsAt.getTime()) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        message: 'This is already the prestation’s time.',
      });
    }
    await this.availability.assertBookable(
      booking.chefProfileId,
      startsAt,
      endFor(booking, startsAt),
      booking.id,
    );

    // A lapsed proposal the hourly job has not marked yet must not block a new one.
    await this.prisma.bookingReschedule.updateMany({
      where: { bookingId, status: 'pending', expiresAt: { lte: now } },
      data: { status: 'expired', decidedAt: now },
    });
    let proposal: RescheduleRow;
    try {
      proposal = await this.prisma.bookingReschedule.create({
        data: {
          bookingId,
          proposedByRole: side,
          proposedByUserId: userId,
          fromStartsAt: booking.startsAt,
          toStartsAt: startsAt,
          expiresAt: rescheduleExpiry(now, booking.startsAt),
        },
        select: RESCHEDULE_VIEW,
      });
    } catch (error) {
      // `uq_booking_reschedules_open`: one open proposal per booking.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'RESCHEDULE_PENDING',
          message: 'A new time is already waiting for an answer.',
        });
      }
      throw error;
    }
    this.logger.log({
      event: 'reschedule.proposed',
      bookingId,
      rescheduleId: proposal.id,
      role: side,
    });

    const other = side === 'client' ? 'chef' : 'client';
    await this.mailer
      .rescheduleProposed({
        bookingId,
        reference: booking.reference,
        from: booking.startsAt,
        to: startsAt,
        expiresAt: proposal.expiresAt,
        proposerName: nameOf(booking, side),
        recipient: { ...contactOf(booking, other), side: other },
      })
      .catch((error: unknown) =>
        this.logger.error(
          { event: 'reschedule.mail_failed', bookingId, rescheduleId: proposal.id },
          stackOf(error),
        ),
      );
    return toRescheduleView(proposal);
  }

  /** The other side confirms or declines; the proposer withdraws. */
  async decide(
    side: RescheduleSide,
    clerkUserId: string,
    bookingId: string,
    decision: RescheduleDecision,
  ) {
    const { booking } = await this.load(side, clerkUserId, bookingId);
    const proposal = await this.prisma.bookingReschedule.findFirst({
      where: { bookingId, status: 'pending' },
      select: RESCHEDULE_VIEW,
    });
    if (!proposal) {
      throw new NotFoundException({
        code: 'RESCHEDULE_NOT_FOUND',
        message: 'No new time is waiting for an answer.',
      });
    }
    const refusal = decisionRefusal(
      proposal.proposedByRole as RescheduleSide,
      side,
      decision,
    );
    if (refusal) {
      throw new ConflictException({
        code: refusal,
        message:
          refusal === 'RESCHEDULE_OWN_PROPOSAL'
            ? 'The other side confirms or declines a new time; you can withdraw yours.'
            : 'Only who proposed a new time can withdraw it.',
      });
    }
    const now = new Date();
    if (proposal.expiresAt.getTime() <= now.getTime()) {
      await this.prisma.bookingReschedule.updateMany({
        where: { id: proposal.id, status: 'pending' },
        data: { status: 'expired', decidedAt: now },
      });
      throw new ConflictException({
        code: 'RESCHEDULE_EXPIRED',
        message: 'This new time was not confirmed in time: the prestation keeps its own.',
      });
    }

    if (decision === 'accepted') {
      const to = proposal.toStartsAt;
      if (
        booking.startsAt.getTime() !== proposal.fromStartsAt.getTime() ||
        !canReschedule(booking.status, booking.startsAt, to, now)
      ) {
        throw notReschedulable();
      }
      const endsAt = endFor(booking, to);
      await this.availability.assertBookable(
        booking.chefProfileId,
        to,
        endsAt,
        booking.id,
      );
      await this.prisma
        .$transaction(async (tx) => {
          const settled = await tx.bookingReschedule.updateMany({
            where: { id: proposal.id, status: 'pending' },
            data: { status: 'accepted', decidedAt: now },
          });
          if (settled.count === 0) throw answeredMeanwhile();
          // Only from the time and status read: a payment or an admin acting
          // meanwhile is reloaded, never overwritten.
          await tx.booking.update({
            where: {
              id: booking.id,
              status: 'confirmed',
              startsAt: proposal.fromStartsAt,
            },
            data: schedule(to, endsAt),
          });
        })
        .catch(changedMeanwhile);
    } else {
      const { count } = await this.prisma.bookingReschedule.updateMany({
        where: { id: proposal.id, status: 'pending' },
        data: { status: decision, decidedAt: now },
      });
      if (count === 0) throw answeredMeanwhile();
    }
    this.logger.log({
      event: 'reschedule.decided',
      bookingId,
      rescheduleId: proposal.id,
      role: side,
      decision,
    });

    if (decision !== 'withdrawn') {
      const proposer = proposal.proposedByRole as RescheduleSide;
      await this.mailer
        .rescheduleAnswered({
          bookingId,
          reference: booking.reference,
          from: proposal.fromStartsAt,
          to: proposal.toStartsAt,
          accepted: decision === 'accepted',
          answererName: nameOf(booking, side),
          recipient: { ...contactOf(booking, proposer), side: proposer },
        })
        .catch((error: unknown) =>
          this.logger.error(
            { event: 'reschedule.mail_failed', bookingId, rescheduleId: proposal.id },
            stackOf(error),
          ),
        );
    }
    return toRescheduleView({ ...proposal, status: decision, decidedAt: now });
  }

  /** Proposals nobody answered in time lapse; the prestation keeps its time. */
  @Cron(CronExpression.EVERY_HOUR, { name: 'booking-reschedules-expiry' })
  @SentryCron('booking-reschedules-expiry', {
    checkinMargin: 10,
    maxRuntime: 10,
    failureIssueThreshold: 2,
  })
  async expireDue(now: Date = new Date()): Promise<number> {
    const started = Date.now();
    try {
      const { count } = await this.prisma.bookingReschedule.updateMany({
        where: { status: 'pending', expiresAt: { lte: now } },
        data: { status: 'expired', decidedAt: now },
      });
      this.logger.log({
        event: 'job.reschedules_expired',
        expired: count,
        ms: Date.now() - started,
      });
      return count;
    } catch (error) {
      this.logger.error({ event: 'job.reschedules_expired_failed' }, stackOf(error));
      return 0;
    }
  }

  /** The caller's own booking, as client or as batch cooker; anyone else's is a 404. */
  private async load(side: RescheduleSide, clerkUserId: string, bookingId: string) {
    const caller =
      side === 'client'
        ? await this.users
            .ensurePersistedFromClerk(clerkUserId)
            .then((user) => ({ userId: user.id, scope: { clientId: user.id } }))
        : await this.users.chefIdentity(clerkUserId).then((chef) => ({
            userId: chef.userId,
            scope: { chefProfileId: chef.chefProfileId },
          }));
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, ...caller.scope },
      select: BOOKING_SELECT,
    });
    if (!booking) throw notFound();
    return { userId: caller.userId, booking };
  }
}

/** The duration stays: the new end follows the new start. */
const endFor = (booking: Booking, startsAt: Date) =>
  new Date(startsAt.getTime() + booking.endsAt.getTime() - booking.startsAt.getTime());

/** How one side is named to the other: the page name, or first name and initial. */
const nameOf = (booking: Booking, side: RescheduleSide) =>
  side === 'chef' ? booking.chefProfile.displayName : shortName(booking.client.fullName);

const contactOf = (booking: Booking, side: RescheduleSide) =>
  side === 'chef' ? booking.chefProfile.user : booking.client;

/** Two answers at once: the second finds the proposal settled. */
const answeredMeanwhile = () =>
  new ConflictException({
    code: 'CHANGED_MEANWHILE',
    message: 'This new time was answered meanwhile. Reload the prestation.',
  });
