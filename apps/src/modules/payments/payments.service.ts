import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Stripe from 'stripe';

import { PaymentStatus, Prisma } from '../../generated/prisma/client';
import { StripeService } from '../../integrations/stripe.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { commissionForPayment } from './commission-policy';
import { assertNoCommissionBlock } from './commission-standing';
import type { CommissionBreakdown } from './commission.util';
import {
  CheckoutSessionDto,
  CreateCheckoutSessionDto,
  PaymentIntentDto,
} from './dto/payment.dto';
import { assertPayable, commissionBlockApplies, CONTRACT_SELECT } from './payment-rules';
import { assertOwnSiteUrl } from './own-site-url';
import { PaymentInvoicesService } from './payment-invoices.service';
import { ChefPayoutsService } from './payouts/chef-payouts.service';
import { withheldCommission } from './payouts/net-price';
import {
  assertNoPendingCesu,
  bookingCoverage,
  settlePayment,
} from './payment-settlement';
import { assertMethodCombinable } from './payment-mix';
import { legacyInvoicingEnabled } from './legacy-invoicing';

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
    private readonly invoices: PaymentInvoicesService,
    private readonly payouts: ChefPayoutsService,
  ) {}

  /**
   * Who sells on a card payment.
   *
   * - « Prix net » (default since 26/11/2026): the SAS charges on its own Stripe
   *   account and is merchant of record; the batch cooker's net is transferred after
   *   the charge (`ChefPayoutsService.payCardNow`), with an autofacture.
   * - Former invoicing (`LEGACY_INVOICING_ENABLED=true`): destination charge in the
   *   batch cooker's name, the commission withheld as `application_fee_amount`.
   */
  private cardRouting(
    chef: { stripeAccountId: string | null },
    booking: { id: string },
    commission: CommissionBreakdown,
  ): Pick<
    Stripe.PaymentIntentCreateParams,
    'on_behalf_of' | 'transfer_data' | 'application_fee_amount' | 'transfer_group'
  > {
    if (!legacyInvoicingEnabled(this.config)) {
      return { transfer_group: booking.id };
    }
    return {
      on_behalf_of: chef.stripeAccountId ?? undefined,
      transfer_data: { destination: chef.stripeAccountId ?? '' },
      // Stripe rejects a zero fee, so a 0 % commission means sending no fee at all.
      ...(commission.amountTtcCents > 0
        ? { application_fee_amount: commission.amountTtcCents }
        : {}),
    };
  }

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
    const { booking, chef, amountTtc } = await this.cardCharge(clerkUserId, bookingId);

    const reusable = await this.findReusableIntent(booking.id, amountTtc);
    if (reusable) {
      return reusable;
    }

    const commission = await this.commissionOn(booking, amountTtc);

    // Seller: the SAS (« prix net ») or, with the former invoicing, the batch cooker
    // through `on_behalf_of` (see `cardRouting`).
    const intent = await this.stripe.getClient().paymentIntents.create({
      amount: amountTtc,
      currency: booking.currency.toLowerCase(),
      ...this.cardRouting(chef, booking, commission),
      metadata: { bookingId: booking.id, bookingReference: booking.reference ?? '' },
    });

    const payment = await this.openCardPayment(booking, chef.id, amountTtc, commission, {
      stripePaymentIntentId: intent.id,
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
   * Everything that must hold before a card moves money for a booking, and the
   * amount it moves: what is **left** to pay, never the booking total.
   */
  private async cardCharge(clerkUserId: string, bookingId: string) {
    if (!this.stripe.configured) {
      throw new ServiceUnavailableException(
        'Stripe is not configured (STRIPE_SECRET_KEY missing).',
      );
    }

    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, clientId: user.id },
      include: { chefProfile: true, serviceOffer: CONTRACT_SELECT.serviceOffer },
    });
    if (!booking) {
      throw new NotFoundException('Booking not found.');
    }
    assertPayable(booking);

    await assertMethodCombinable(this.prisma, booking.id, 'cb');
    const chef = booking.chefProfile;
    // Re-checked here, not just at booking time: vetting can be revoked between the
    // booking and the payment, and this is the last gate before money moves to the
    // chef's connected account. Finishing Stripe onboarding is not admin approval.
    // Being offline does not excuse a client from paying a prestation already done.
    if (!chef.isVerified || (commissionBlockApplies(booking) && !chef.isActive)) {
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
    if (commissionBlockApplies(booking)) {
      await assertNoCommissionBlock(
        this.prisma,
        chef.id,
        this.config.getOrThrow<number>('payments.commissionDebitMaxAttempts'),
      );
    }

    // The card charge covers **what is left**, not the booking total: the client may
    // already have paid part of it in CESU, and charging the full amount again would
    // overcharge them.
    await assertNoPendingCesu(this.prisma, booking.id);
    const coverage = await bookingCoverage(this.prisma, booking);
    const amountTtc = coverage.remainingAmountCents;
    if (amountTtc <= 0) {
      throw new ConflictException(
        coverage.amountTtcCents <= 0
          ? 'Booking amount must be greater than zero.'
          : 'This booking is already fully paid.',
      );
    }
    return {
      booking,
      chef: { ...chef, stripeAccountId: chef.stripeAccountId },
      amountTtc,
    };
  }

  /**
   * CGV V1 7.3 (decision of 2026-11-19): what is left on a booking, charged off session
   * on the card saved at booking. Same destination charge and commission as the
   * client's own card payment; the webhook settles it. The payment row is written first
   * and seeds the idempotency key, so a replay is the same charge, never a second one.
   *
   * Never throws for a refused card: the outcome says so, and the client settles on the
   * payment screen (7.5).
   */
  async chargeSavedCard(
    bookingId: string,
  ): Promise<{ ok: true; paymentId: string } | { ok: false; code: string }> {
    if (!this.stripe.configured) return { ok: false, code: 'PAYMENTS_UNAVAILABLE' };
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { chefProfile: true, serviceOffer: CONTRACT_SELECT.serviceOffer },
    });
    if (!booking?.stripeCustomerId || !booking.stripePaymentMethodId) {
      return { ok: false, code: 'CARD_NOT_SAVED' };
    }
    const chef = booking.chefProfile;
    if (!chef.stripeAccountId || !chef.stripeChargesEnabled) {
      return { ok: false, code: 'CHEF_ACCOUNT_NOT_READY' };
    }
    try {
      assertPayable(booking);
      await assertNoPendingCesu(this.prisma, booking.id);
    } catch (error) {
      const code =
        (error as { response?: { code?: string } }).response?.code ?? 'NOT_PAYABLE';
      return { ok: false, code };
    }
    const amountTtc = (await bookingCoverage(this.prisma, booking)).remainingAmountCents;
    if (amountTtc <= 0) return { ok: false, code: 'ALREADY_PAID' };

    const commission = await this.commissionOn(booking, amountTtc);
    const payment = await this.openCardPayment(
      booking,
      chef.id,
      amountTtc,
      commission,
      {},
    );
    let intent: Stripe.PaymentIntent | null = null;
    let code = 'card_error';
    try {
      intent = await this.stripe.getClient().paymentIntents.create(
        {
          amount: amountTtc,
          currency: booking.currency.toLowerCase(),
          customer: booking.stripeCustomerId,
          payment_method: booking.stripePaymentMethodId,
          payment_method_types: ['card'],
          off_session: true,
          confirm: true,
          ...this.cardRouting(chef, booking, commission),
          metadata: {
            bookingId: booking.id,
            bookingReference: booking.reference ?? '',
            paymentId: payment.id,
            purpose: 'service',
          },
        },
        { idempotencyKey: `booking-charge-${payment.id}` },
      );
      code = intent.status;
    } catch (error) {
      const failure = error as { code?: string; decline_code?: string };
      code = failure.decline_code ?? failure.code ?? code;
    }

    if (intent) {
      // The webhook may have linked it already through `metadata.paymentId`.
      await this.prisma.payment.updateMany({
        where: { id: payment.id, stripePaymentIntentId: null },
        data: { stripePaymentIntentId: intent.id },
      });
    }
    if (intent && (intent.status === 'succeeded' || intent.status === 'processing')) {
      this.logger.log({
        event: 'booking.card_charged',
        bookingId,
        paymentId: payment.id,
      });
      return { ok: true, paymentId: payment.id };
    }
    await this.retireAttempt(payment.id, `Off-session charge refused: ${code}.`);
    this.logger.warn({ event: 'booking.card_charge_refused', bookingId, code });
    return { ok: false, code };
  }

  /** What Lab's Food keeps on this payment: the accepted offer's deal, or the rate in force. */
  private commissionOn(
    booking: { id: string },
    amountCents: number,
  ): Promise<CommissionBreakdown> {
    return commissionForPayment(this.prisma, booking, amountCents, {
      rateBps: this.config.get<number>('payments.commissionRateBps', 1500),
      vatRateBps: this.config.get<number>('payments.commissionVatRateBps', 2000),
    });
  }

  /**
   * The `pending` card payment and the commission Stripe withholds with it. The
   * commission's rate and VAT are frozen on the row, so a later rate change cannot
   * rewrite history.
   */
  private openCardPayment(
    booking: { id: string; currency: string },
    chefProfileId: string,
    amountTtc: number,
    commission: CommissionBreakdown,
    stripe: { stripePaymentIntentId?: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          bookingId: booking.id,
          method: 'cb',
          status: 'pending',
          amountTtc,
          currency: booking.currency,
          ...(stripe.stripePaymentIntentId
            ? { stripePaymentIntentId: stripe.stripePaymentIntentId }
            : {}),
          commission: {
            create: {
              chefProfileId,
              status: 'pending',
              // « Prix net »: kept back when the SAS pays the batch cooker, like CESU.
              ...(legacyInvoicingEnabled(this.config)
                ? {
                    rateBps: commission.rateBps,
                    vatRateBps: commission.vatRateBps,
                    // What the rate was applied to. On a booking paid in several
                    // instalments the booking total is no longer the base of any single
                    // line, so without this an audit cannot replay the rate.
                    basisAmountCents: amountTtc,
                    amountHtCents: commission.amountHtCents,
                    amountVatCents: commission.amountVatCents,
                    amountTtcCents: commission.amountTtcCents,
                    collectionMethod: 'stripe_application_fee' as const,
                  }
                : withheldCommission(amountTtc, commission.rateBps)),
            },
          },
        },
      });
      if (stripe.stripePaymentIntentId) {
        await tx.booking.update({
          where: { id: booking.id },
          data: { stripePaymentIntentId: stripe.stripePaymentIntentId },
        });
      }
      return created;
    });
  }

  /**
   * `POST /payments/checkout-session` (FLOW-03 §3): the card payment as a Stripe
   * Checkout page the browser is sent to. Same destination charge as the intent, so
   * the same webhook settles it.
   *
   * - The amount is ours. `amountCents` from the browser is only compared with it
   *   (`409 AMOUNT_MISMATCH`): the screen may be showing a stale balance.
   * - Two quick clicks get the same session back, not two.
   * - The return URLs must point at one of our own sites: Stripe would otherwise
   *   send a paying client wherever the caller asked.
   */
  async createCheckoutSession(
    clerkUserId: string,
    payload: CreateCheckoutSessionDto,
  ): Promise<CheckoutSessionDto> {
    this.assertOwnUrl(payload.successUrl);
    this.assertOwnUrl(payload.cancelUrl);

    const { booking, chef, amountTtc } = await this.cardCharge(
      clerkUserId,
      payload.orderId,
    );
    if (payload.amountCents !== amountTtc) {
      throw new ConflictException({
        code: 'AMOUNT_MISMATCH',
        message: `${amountTtc} minor units are due on this booking, not ${payload.amountCents}.`,
        amountCents: amountTtc,
      });
    }

    const open = await this.findOpenCheckout(booking.id, amountTtc);
    if (open) return open;

    const commission = await this.commissionOn(booking, amountTtc);
    const payment = await this.openCardPayment(
      booking,
      chef.id,
      amountTtc,
      commission,
      {},
    );
    const metadata = { bookingId: booking.id, paymentId: payment.id };

    let session: Stripe.Checkout.Session;
    try {
      session = await this.stripe.getClient().checkout.sessions.create(
        {
          mode: 'payment',
          client_reference_id: booking.id,
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: booking.currency.toLowerCase(),
                unit_amount: amountTtc,
                product_data: {
                  name: `Prestation Lab’s Food ${booking.reference ?? ''}`.trim(),
                },
              },
            },
          ],
          payment_intent_data: {
            // Same seller as on the direct intent above.
            ...this.cardRouting(chef, booking, commission),
            // The intent only exists once the client pays: this is how its webhook
            // finds the payment row.
            metadata,
          },
          metadata,
          success_url: payload.successUrl,
          cancel_url: payload.cancelUrl,
        },
        { idempotencyKey: `checkout:${payment.id}` },
      );
    } catch (error) {
      await this.retireAttempt(
        payment.id,
        `Stripe refused the checkout session: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      throw error;
    }

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { metadata: { checkoutSessionId: session.id } },
    });
    return { sessionId: session.id, url: session.url ?? '' };
  }

  /** A checkout page already open for this booking and this amount, if any. */
  private async findOpenCheckout(
    bookingId: string,
    amountTtc: number,
  ): Promise<CheckoutSessionDto | null> {
    const pending = await this.prisma.payment.findFirst({
      where: {
        bookingId,
        method: 'cb',
        status: 'pending',
        purpose: 'service',
        stripePaymentIntentId: null,
        metadata: { path: ['checkoutSessionId'], not: Prisma.AnyNull },
      },
      orderBy: { createdAt: 'desc' },
    });
    const sessionId = (pending?.metadata as { checkoutSessionId?: string } | null)
      ?.checkoutSessionId;
    if (!pending || !sessionId) return null;

    let session: Stripe.Checkout.Session;
    try {
      session = await this.stripe.getClient().checkout.sessions.retrieve(sessionId);
    } catch {
      // Stripe has not said this session is dead: leave the row, open a new page.
      return null;
    }
    if (session.payment_status === 'paid') {
      // The webhook has not landed yet; a second page would bill the client twice.
      throw new ConflictException('This booking has already been paid.');
    }
    if (session.status !== 'open' || !session.url || pending.amountTtc !== amountTtc) {
      await this.retireAttempt(pending.id, `Checkout session is ${session.status}.`);
      return null;
    }
    return { sessionId: session.id, url: session.url };
  }

  private assertOwnUrl(url: string): void {
    assertOwnSiteUrl(
      this.config,
      url,
      'successUrl and cancelUrl must point at a Lab’s Food site.',
    );
  }

  /**
   * The payment row of a client PaymentIntent. An intent created by a Checkout page
   * is not known when the row is written: it names its row in `metadata.paymentId`,
   * and is attached here the first time Stripe mentions it.
   */
  private async paymentOfIntent(intent: Stripe.PaymentIntent) {
    const known = await this.prisma.payment.findUnique({
      where: { stripePaymentIntentId: intent.id },
    });
    if (known) return known;

    const paymentId = intent.metadata?.paymentId;
    if (!paymentId) return null;
    const fromCheckout = await this.prisma.payment.findFirst({
      where: { id: paymentId, method: 'cb', stripePaymentIntentId: null },
    });
    if (!fromCheckout) return null;
    return this.prisma.payment.update({
      where: { id: fromCheckout.id },
      data: { stripePaymentIntentId: intent.id },
    });
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
        purpose: 'service',
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
    const payment = await this.paymentOfIntent(intent);
    if (!payment) {
      this.logger.warn(`No payment row for PaymentIntent ${intent.id}; ignoring.`);
      return;
    }
    if (payment.status === PaymentStatus.succeeded) {
      return;
    }
    if (payment.purpose !== 'service') {
      // A courses capture covers no part of the prestation, has no commission and no
      // invoice A: never settled here.
      this.logger.warn(
        `Payment ${payment.id} is a ${payment.purpose} payment; not settled here.`,
      );
      return;
    }

    const paidAt = new Date();
    const outcome = await this.prisma.$transaction(async (tx) => {
      const settled = await settlePayment(tx, payment, {
        paidAt,
        stripeChargeId: idOf(intent.latest_charge),
      });
      // Former invoicing: Stripe withheld the commission at charge time as the
      // `application_fee_amount`, so it is collected with the charge. « Prix net »: it
      // is kept back when the batch cooker is paid (`payCardNow` below).
      await tx.commission.updateMany({
        where: { paymentId: payment.id, collectionMethod: 'stripe_application_fee' },
        data: { status: 'collected', collectedAt: paidAt },
      });
      // The client's invoice, numbered in the same transaction: the SAS's own (« prix
      // net ») or facture A in the chef's name (former invoicing). The PDF is drawn once
      // the transaction is committed.
      const invoice = await this.invoices.issue(tx, payment.id, paidAt);
      return { ...settled, invoice };
    });
    await this.invoices.archive(outcome.invoice.id);
    if (!legacyInvoicingEnabled(this.config)) await this.payouts.payCardNow(payment.id);

    this.logger.log(
      `Payment ${payment.id} succeeded (booking ${payment.bookingId}); ` +
        `${outcome.coveredAmountCents}/${outcome.bookingAmountTtcCents} covered` +
        `${outcome.bookingConfirmed ? ', booking confirmed' : ''}; ` +
        `invoice ${outcome.invoice.invoiceNumber}.`,
    );
  }

  /**
   * `payment_intent.payment_failed`. The booking stays `pending` so the client can
   * retry with a fresh `POST /payments/intent`.
   */
  async handlePaymentIntentFailed(intent: Stripe.PaymentIntent): Promise<void> {
    const payment = await this.paymentOfIntent(intent);
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
