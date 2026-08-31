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
import { computeCommission } from './commission.util';
import { PaymentIntentDto } from './dto/payment.dto';

/** PaymentIntent states that can still be confirmed by the client. */
const CONFIRMABLE_INTENT_STATUSES = new Set<Stripe.PaymentIntent.Status>([
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
  'processing',
]);

function idOf(value: string | { id: string } | null | undefined): string | null {
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

    const amountTtc = booking.amountTtc ?? booking.priceCents;
    if (amountTtc <= 0) {
      throw new ConflictException('Booking amount must be greater than zero.');
    }

    const chef = booking.chefProfile;
    if (
      !chef.stripeAccountId ||
      !chef.stripeChargesEnabled ||
      !chef.stripePayoutsEnabled
    ) {
      throw new ConflictException(
        'The chef has not finished Stripe Connect onboarding, so this booking cannot be paid yet.',
      );
    }

    const reusable = await this.findReusableIntent(booking.id);
    if (reusable) {
      return reusable;
    }

    const commission = computeCommission(amountTtc, {
      rateBps: this.config.get<number>('payments.commissionRateBps', 1500),
      vatRateBps: this.config.get<number>('payments.commissionVatRateBps', 2000),
    });

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
   */
  private async findReusableIntent(bookingId: string): Promise<PaymentIntentDto | null> {
    const pending = await this.prisma.payment.findFirst({
      where: { bookingId, status: 'pending', stripePaymentIntentId: { not: null } },
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

  /**
   * `payment_intent.succeeded`. Stripe delivers at least once, so a payment already
   * marked `succeeded` is a no-op rather than a second write.
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
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'succeeded',
          paidAt,
          stripeChargeId: idOf(intent.latest_charge),
          failureReason: null,
          // The whole TTC amount of a home batch-cooking session is eligible for the
          // 50 % "service à la personne" tax credit.
          taxCreditEligibleAmount: payment.amountTtc,
        },
      });
      await tx.commission.updateMany({
        where: { paymentId: payment.id },
        data: { status: 'collected', collectedAt: paidAt },
      });
      await tx.booking.update({
        where: { id: payment.bookingId },
        data: { status: 'confirmed' },
      });
    });

    this.logger.log(`Payment ${payment.id} succeeded (booking ${payment.bookingId}).`);
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
