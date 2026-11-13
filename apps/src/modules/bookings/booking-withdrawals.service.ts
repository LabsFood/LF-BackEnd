import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { stackOf } from '../../common/logging/app-logger';
import { DAY_MS } from '../../common/paris-time';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { changedMeanwhile } from '../dishes/dishes.service';
import { NotificationsService } from '../notifications/notifications.service';
import { coveredAmount } from '../payments/payment-settlement';
import { UsersService } from '../users/users.service';
import { BookingsMailer } from './bookings.mailer';
import { BookingsService } from './bookings.service';
import { withdrawalRefused } from './domain/contract.errors';
import { WITHDRAWAL_DECLARATION, withdrawalFor } from './domain/withdrawal.rules';

/** CGV art. 15.5: what is refundable goes back within 14 days of the withdrawal. */
const REFUND_WITHIN_MS = 14 * DAY_MS;

const WITHDRAWAL_SELECT = {
  id: true,
  reference: true,
  status: true,
  concludedAt: true,
  withdrawnAt: true,
  earlyExecutionRequestedAt: true,
  amountTtc: true,
  priceCents: true,
  client: { select: { email: true, fullName: true } },
  chefProfile: { select: { displayName: true, userId: true } },
  // How the money came in, for the refund by hand.
  payments: {
    where: { status: { in: ['pending', 'succeeded'] } },
    select: { method: true },
  },
} satisfies Prisma.BookingSelect;

/**
 * The online withdrawal (CGV art. 15.2, « Se rétracter »). Lab's Food receives it on
 * the batch cooker's behalf. The booking is cancelled at once and acknowledged by
 * email; the refund is made by hand, the team being told what and by when.
 */
@Injectable()
export class BookingWithdrawalsService {
  private readonly logger = new Logger(BookingWithdrawalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly bookings: BookingsService,
    private readonly mailer: BookingsMailer,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** `POST /me/bookings/{id}/withdrawal`: the « Confirmer la rétractation » step. */
  async withdraw(clerkUserId: string, id: string) {
    const client = await this.users.ensurePersistedFromClerk(clerkUserId);
    const booking = await this.prisma.booking.findFirst({
      where: { id, clientId: client.id },
      select: WITHDRAWAL_SELECT,
    });
    if (!booking) {
      throw new NotFoundException({
        code: 'BOOKING_NOT_FOUND',
        message: 'Booking not found.',
      });
    }

    const now = new Date();
    const paidCents = await coveredAmount(this.prisma, id);
    const withdrawal = withdrawalFor(booking, paidCents, now);
    if (withdrawal.refusal) throw withdrawalRefused(withdrawal.refusal);

    // A legal right: it cancels from any status still open, past `canTransition`.
    // Two taps, or a payment landing meanwhile, write nothing twice.
    await this.prisma.booking
      .update({
        where: { id, status: booking.status, withdrawnAt: null },
        data: {
          status: 'cancelled',
          withdrawnAt: now,
          withdrawalDueCents: withdrawal.dueCents,
        },
      })
      .catch(changedMeanwhile);

    const facts = {
      paidCents,
      dueCents: withdrawal.dueCents,
      refundCents: withdrawal.refundCents,
    };
    this.logger.log({
      event: 'booking.withdrawn',
      bookingId: id,
      from: booking.status,
      ...facts,
    });
    await this.audit.record({
      actorType: 'client',
      actorUserId: client.id,
      action: 'booking.withdrawn',
      subjectType: 'booking',
      subjectId: id,
      metadata: {
        channel: 'online',
        from: booking.status,
        declaration: WITHDRAWAL_DECLARATION,
        submittedAt: now.toISOString(),
        ...facts,
      },
    });

    await this.acknowledge(booking, now, facts);
    await this.tellOthers(booking, now, facts);
    return this.bookings.detailFor('client', clerkUserId, id);
  }

  /**
   * The acknowledgement on a durable medium, sent without delay. Claimed first, so
   * two instances never send it twice; given back when it did not go (Brevo down,
   * template unset), for the contract-mail job to try again.
   */
  async acknowledge(
    booking: {
      id: string;
      reference: string | null;
      client: { email: string; fullName: string | null };
      chefProfile: { displayName: string };
    },
    submittedAt: Date,
    facts: { dueCents: number | null; refundCents: number | null },
  ): Promise<boolean> {
    const claimed = await this.prisma.booking.updateMany({
      where: { id: booking.id, withdrawalAckSentAt: null },
      data: { withdrawalAckSentAt: new Date() },
    });
    if (claimed.count !== 1) return false;

    const { sent } = await this.mailer
      .withdrawalAck({
        bookingId: booking.id,
        reference: booking.reference,
        client: booking.client,
        chefName: booking.chefProfile.displayName,
        submittedAt,
        declaration: WITHDRAWAL_DECLARATION,
        ...facts,
      })
      .catch((error: unknown) => {
        this.logger.error(
          { event: 'booking.withdrawal_ack_failed', bookingId: booking.id },
          stackOf(error),
        );
        return { sent: false };
      });
    if (!sent) {
      this.logger.warn({
        event: 'booking.withdrawal_ack_not_sent',
        bookingId: booking.id,
      });
      await this.prisma.booking.update({
        where: { id: booking.id },
        data: { withdrawalAckSentAt: null },
      });
    }
    return sent;
  }

  /** The team, who refunds by hand, and the batch cooker, whose slot is freed. */
  private async tellOthers(
    booking: {
      id: string;
      reference: string | null;
      status: string;
      chefProfile: { userId: string };
      payments: { method: string }[];
    },
    now: Date,
    facts: { paidCents: number; dueCents: number | null; refundCents: number | null },
  ) {
    const methods = [...new Set(booking.payments.map((payment) => payment.method))];
    await Promise.allSettled([
      this.mailer.withdrawalAdmin({
        bookingId: booking.id,
        reference: booking.reference,
        status: booking.status,
        methods,
        deadline: new Date(now.getTime() + REFUND_WITHIN_MS),
        ...facts,
      }),
      this.notifications.notify(booking.chefProfile.userId, 'booking.withdrawn', {
        type: 'booking',
        id: booking.id,
      }),
    ]).then((outcomes) =>
      outcomes.forEach((outcome, index) => {
        if (outcome.status === 'rejected') {
          this.logger.error(
            {
              event:
                index === 0
                  ? 'booking.withdrawal_admin_failed'
                  : 'booking.withdrawal_notify_failed',
              bookingId: booking.id,
            },
            stackOf(outcome.reason),
          );
        }
      }),
    );
  }
}
