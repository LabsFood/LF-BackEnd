import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Stripe from 'stripe';

import { PaymentStatus } from '../../generated/prisma/client';
import { StripeService } from '../../integrations/stripe.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { assertNoCommissionBlock } from './commission-standing';
import { computeCommission } from './commission.util';
import { PaymentIntentDto } from './dto/payment.dto';
import { bookingCoverage, settlePayment } from './payment-settlement';

/** PaymentIntent states that can still be confirmed by the client. */
const CONFIRMABLE_INTENT_STATUSES = new Set<Stripe.PaymentIntent.Status>([
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
  'processing',
]);

export function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly config: ConfigService,
    private readonly users: UsersService,
  ) {}

  /**
   * Card payment on a booking, as a Stripe Connect **destination charge**: the client
   * is charged on the platform account, the chef's connected account receives the
   * amount minus `application_fee_amount`, and the platform keeps that fee. The
   * commission is therefore collected atomically with the payment — no separate debit.
   *
   * The commission rate and VAT in force are frozen onto the `Commission` row so a
   * later rate change cannot rewrite history.
   */
  async createIntentForBooking(
    clerkUserId: string,
    bookingId: string,
  ): Promise<PaymentIntentDto> {
    if (!this.stripe.configured) {
      throw new ServiceUnavailableException(
        'Stripe is not configured (STRIPE_SECRET_KEY missing).',
      );
    }

    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, clientId: user.id },
      include: { chefProfile: true },
    });
    if (!booking) {
      throw new NotFoundException('Booking not found.');
    }
    if (booking.status !== 'pending') {
      throw new ConflictException(
        `Booking ${booking.id} is ${booking.status}; only a pending booking can be paid.`,
      );
    }

    const chef = booking.chefProfile;
    // Re-checked here, not just at booking time: vetting can be revoked between the
    // booking and the payment, and this is the last gate before money moves to the
    // chef's connected account. Finishing Stripe onboarding is not admin approval.
    if (!chef.isActive || !chef.isVerified) {
      throw new ConflictException(
        'The chef is not verified by an admin, so this booking cannot be paid.',
      );
    }
    if (
      !chef.stripeAccountId ||
      !chef.stripeChargesEnabled ||
      !chef.stripePayoutsEnabled
    ) {
      throw new ConflictException(
        'The chef has not finished Stripe Connect onboarding, so this booking cannot be paid yet.',
      );
    }
    // §6 guard: an uncollected commission stops the chef taking on new work.
    await assertNoCommissionBlock(
      this.prisma,
      chef.id,
      this.config.getOrThrow<number>('payments.commissionDebitMaxAttempts'),
    );

    // The card charge covers **what is left**, not the booking total: the client may
    // already have paid part of it in CESU, and charging the full amount again would
    // overcharge them.
    const coverage = await bookingCoverage(this.prisma, booking);
    const amountTtc = coverage.remainingAmountCents;
    if (amountTtc <= 0) {
      throw new ConflictException(
        coverage.amountTtcCents <= 0
          ? 'Booking amount must be greater than zero.'
          : 'This booking is already fully paid.',
      );
    }

    const reusable = await this.findReusableIntent(booking.id, amountTtc);
    if (reusable) {
      return reusable;
    }

    const commission = computeCommission(amountTtc, {
      rateBps: this.config.get<number>('payments.commissionRateBps', 1500),
      vatRateBps: this.config.get<number>('payments.commissionVatRateBps', 2000),
    });

    // ponytail: no `on_behalf_of` here — decided 2026-09-05 (see
    // docs/evolution/payments-stripe-cb-evolution.md) to make the chef merchant of
    // record for invoice A, still not implemented. Add it to this call when invoice A
    // seller-of-record is built; it's unrelated to the commission debit, which must
    // never carry `on_behalf_of` (see commission-debits.service.ts).
    const intent = await this.stripe.getClient().paymentIntents.create({
      amount: amountTtc,
      currency: booking.currency.toLowerCase(),
      transfer_data: { destination: chef.stripeAccountId },
      // Stripe rejects a zero fee, so a 0 % commission means sending no fee at all.
      ...(commission.amountTtcCents > 0
        ? { application_fee_amount: commission.amountTtcCents }
        : {}),
      metadata: { bookingId: booking.id, bookingReference: booking.reference ?? '' },
    });

    const payment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          bookingId: booking.id,
          method: 'cb',
          status: 'pending',
          amountTtc,
          currency: booking.currency,
          stripePaymentIntentId: intent.id,
          commission: {
            create: {
              chefProfileId: chef.id,
              rateBps: commission.rateBps,
              vatRateBps: commission.vatRateBps,
              // What the rate was applied to. On a booking paid in several instalments
              // the booking total is no longer the base of any single line, so without
              // this an audit cannot replay rateBps x base = amountHtCents.
              basisAmountCents: amountTtc,
              amountHtCents: commission.amountHtCents,
              amountVatCents: commission.amountVatCents,
              amountTtcCents: commission.amountTtcCents,
              collectionMethod: 'stripe_application_fee',
              status: 'pending',
            },
          },
        },
      });
      await tx.booking.update({
        where: { id: booking.id },
        data: { stripePaymentIntentId: intent.id },
      });
      return created;
    });

    return {
      paymentId: payment.id,
      clientSecret: intent.client_secret ?? '',
      amountTtc,
      currency: booking.currency,
      commissionTtc: commission.amountTtcCents,
    };
  }

  /**
   * A double-click must not create a second PaymentIntent for the same booking, so an
   * existing pending attempt is handed back instead. A Stripe-side intent that can no
   * longer be confirmed (cancelled, or expired) is dropped so a fresh one is created.
   *
   * An attempt whose amount no longer matches what is owed is dropped too: a CESU payment
   * confirmed in between lowers the remaining amount, and reusing the old intent would
   * overcharge the client. Every attempt abandoned for a reason Stripe has confirmed is
   * marked `failed` rather than left `pending` — a stale `pending` row is invisible to
   * the coverage sum but clutters the booking's payment history for good.
   */
  private async findReusableIntent(
    bookingId: string,
    expectedAmountTtc: number,
  ): Promise<PaymentIntentDto | null> {
    const pending = await this.prisma.payment.findFirst({
      where: {
        bookingId,
        method: 'cb',
        status: 'pending',
        stripePaymentIntentId: { not: null },
      },
      include: { commission: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!pending?.stripePaymentIntentId) {
      return null;
    }

    let intent: Stripe.PaymentIntent;
    try {
      intent = await this.stripe
        .getClient()
        .paymentIntents.retrieve(pending.stripePaymentIntentId);
    } catch (error) {
      // Left `pending` on purpose: Stripe has not told us this intent is dead, and it may
      // still succeed and arrive by webhook. Retiring it here would orphan a real payment.
      this.logger.warn(
        `Could not retrieve PaymentIntent ${pending.stripePaymentIntentId}; creating a new one. ${
          error instanceof Error ? error.message : ''
        }`,
      );
      return null;
    }

    if (intent.status === 'succeeded') {
      // The webhook has not landed yet; charging again would double-bill the client.
      throw new ConflictException('This booking has already been paid.');
    }
    if (!CONFIRMABLE_INTENT_STATUSES.has(intent.status) || !intent.client_secret) {
      await this.retireAttempt(pending.id, `PaymentIntent is ${intent.status}.`);
      return null;
    }
    if (pending.amountTtc !== expectedAmountTtc) {
      await this.retireAttempt(
        pending.id,
        `Superseded: ${expectedAmountTtc} minor units are now due instead of ${pending.amountTtc}.`,
      );
      return null;
    }

    return {
      paymentId: pending.id,
      clientSecret: intent.client_secret,
      amountTtc: pending.amountTtc,
      currency: pending.currency,
      commissionTtc: pending.commission?.amountTtcCents ?? 0,
    };
  }

  /** Closes an abandoned card attempt, along with the commission that hung off it. */
  private async retireAttempt(paymentId: string, reason: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'failed', failureReason: reason },
      });
      await tx.commission.updateMany({
        where: { paymentId },
        data: { status: 'failed' },
      });
    });
  }

  /**
   * `payment_intent.succeeded` on a **client** payment. Stripe delivers at least once, so
   * a payment already marked `succeeded` is a no-op rather than a second write.
   *
   * The webhook router looks the intent up in `commission_debits` first: a commission
   * debit and a client payment are both PaymentIntents on the platform account, and only
   * a database lookup tells them apart. Discriminating on `metadata` would be wrong —
   * a `Dispute` carries an empty one and a `Mandate` has none at all.
   *
   * `settlePayment` does the actual settling, shared with the CESU flow, and confirms the
   * booking only once its payments cover it — a booking may be part card, part CESU.
   */
  async handlePaymentIntentSucceeded(intent: Stripe.PaymentIntent): Promise<void> {
    const payment = await this.prisma.payment.findUnique({
      where: { stripePaymentIntentId: intent.id },
    });
    if (!payment) {
      this.logger.warn(`No payment row for PaymentIntent ${intent.id}; ignoring.`);
      return;
    }
    if (payment.status === PaymentStatus.succeeded) {
      return;
    }

    const paidAt = new Date();
    const outcome = await this.prisma.$transaction(async (tx) => {
      const settled = await settlePayment(tx, payment, {
        paidAt,
        stripeChargeId: idOf(intent.latest_charge),
      });
      // The card commission was withheld by Stripe at charge time as the
      // `application_fee_amount`, so it is collected the moment the charge is: there is
      // no invoice and no separate debit on this path.
      await tx.commission.updateMany({
        where: { paymentId: payment.id },
        data: { status: 'collected', collectedAt: paidAt },
      });
      return settled;
    });

    this.logger.log(
      `Payment ${payment.id} succeeded (booking ${payment.bookingId}); ` +
        `${outcome.coveredAmountCents}/${outcome.bookingAmountTtcCents} covered` +
        `${outcome.bookingConfirmed ? ', booking confirmed' : ''}.`,
    );
  }

  /**
   * `payment_intent.payment_failed`. The booking stays `pending` so the client can
   * retry with a fresh `POST /payments/intent`.
   */
  async handlePaymentIntentFailed(intent: Stripe.PaymentIntent): Promise<void> {
    const payment = await this.prisma.payment.findUnique({
      where: { stripePaymentIntentId: intent.id },
    });
    if (!payment) {
      this.logger.warn(`No payment row for PaymentIntent ${intent.id}; ignoring.`);
      return;
    }
    // A late failure event must never undo a payment Stripe already settled.
    if (payment.status !== PaymentStatus.pending) {
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'failed',
          failureReason:
            intent.last_payment_error?.message ?? 'Stripe reported a failed payment.',
        },
      });
      await tx.commission.updateMany({
        where: { paymentId: payment.id },
        data: { status: 'failed' },
      });
    });

    this.logger.log(`Payment ${payment.id} failed (booking ${payment.bookingId}).`);
  }

  /**
   * `charge.refunded`. Passive bookkeeping only — this phase issues no refunds itself.
   *
   * `Commission.status` is left untouched on purpose: Stripe does not refund the
   * `application_fee_amount` unless explicitly asked, so the commission really was
   * collected. Clawing it back belongs with an admin refund flow, which does not exist
   * yet. A refunded payment drops out of the fiscal attestation total on its own,
   * because that sum only counts `succeeded` payments.
   *
   * ponytail: no admin-initiated refund flow, so `Commission.status` never gets clawed
   * back on a refund today. Build the refund endpoint (and its commission reversal, same
   * shape as `handleDebitDisputed`) when a refund is actually needed.
   */
  async handleChargeRefunded(charge: Stripe.Charge): Promise<void> {
    const paymentIntentId = idOf(charge.payment_intent);
    const payment = await this.prisma.payment.findFirst({
      where: {
        OR: [
          { stripeChargeId: charge.id },
          ...(paymentIntentId ? [{ stripePaymentIntentId: paymentIntentId }] : []),
        ],
      },
    });
    if (!payment) {
      this.logger.warn(`No payment row for refunded charge ${charge.id}; ignoring.`);
      return;
    }

    const status: PaymentStatus =
      charge.amount_refunded >= charge.amount ? 'refunded' : 'partially_refunded';
    if (payment.status === status && payment.refundedAmount === charge.amount_refunded) {
      return;
    }

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status,
        stripeChargeId: payment.stripeChargeId ?? charge.id,
        refundedAmount: charge.amount_refunded,
        refundedAt: new Date(),
      },
    });

    this.logger.log(
      `Payment ${payment.id} ${status} (${charge.amount_refunded}/${charge.amount}).`,
    );
  }
}
