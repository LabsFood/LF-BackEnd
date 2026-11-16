import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type Stripe from 'stripe';

import { StripeService } from '../../integrations/stripe.service';

/** What a card refused, in Stripe's words: the code the screens explain. */
export interface HoldFailure {
  ok: false;
  code: string;
  paymentIntentId: string | null;
  /** 3-D Secure asked for: the client authenticates on the site, then retries. */
  needsAuthentication: boolean;
}

export interface HoldPlaced {
  ok: true;
  intent: Stripe.PaymentIntent;
  /** Stripe's `capture_before`, in seconds, when it gives one. */
  captureBefore: number | null;
}

const idOf = (value: string | { id: string } | null | undefined) =>
  typeof value === 'string' ? value : (value?.id ?? null);

/**
 * Recettes lot 6: every Stripe call of the grocery flow, and nothing else.
 *
 * The groceries are a destination charge like the service card payments
 * (`on_behalf_of` and `transfer_data` to the chef), with **no application fee**: Lab's
 * Food keeps nothing on the ingredients. The one exception is the chef's own choice of
 * an instant payout, whose fee is taken at capture (decision of 16/11).
 *
 * Idempotency keys come from our row ids: a call replayed after a crash is the same
 * call, never a second hold or a second capture.
 */
@Injectable()
export class GroceriesStripe {
  constructor(private readonly stripe: StripeService) {}

  get configured(): boolean {
    return this.stripe.configured;
  }

  private client(): Stripe {
    if (!this.stripe.configured) {
      throw new ServiceUnavailableException({
        code: 'PAYMENTS_UNAVAILABLE',
        message: 'Stripe is not configured (STRIPE_SECRET_KEY missing).',
      });
    }
    return this.stripe.getClient();
  }

  /** The client's customer on the platform account, where the card is saved. */
  async createCustomer(input: { email: string; name: string | null; userId: string }) {
    const customer = await this.client().customers.create(
      {
        email: input.email,
        name: input.name ?? undefined,
        metadata: { userId: input.userId },
      },
      { idempotencyKey: `grocery-customer-${input.userId}` },
    );
    return customer.id;
  }

  /**
   * A Stripe Checkout page in `setup` mode for an off-session card (CGV 7.2): the same
   * hosted page as the service card payment, no card data on our sites. Its SetupIntent
   * carries the run id, so the webhook finds it before the client is back.
   */
  async createSetupSession(input: {
    customerId: string;
    runId: string;
    successUrl: string;
    cancelUrl: string;
  }) {
    return this.client().checkout.sessions.create({
      mode: 'setup',
      customer: input.customerId,
      currency: 'eur',
      payment_method_types: ['card'],
      setup_intent_data: { metadata: { groceryRunId: input.runId, purpose: 'courses' } },
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: { groceryRunId: input.runId },
    });
  }

  /** The SetupIntent a setup page produced, with its card. */
  async setupIntentOfSession(sessionId: string): Promise<Stripe.SetupIntent | null> {
    const session = await this.client().checkout.sessions.retrieve(sessionId, {
      expand: ['setup_intent.payment_method'],
    });
    return (session.setup_intent as Stripe.SetupIntent | null) ?? null;
  }

  async retrieveSetupIntent(id: string) {
    return this.client().setupIntents.retrieve(id, { expand: ['payment_method'] });
  }

  /**
   * The hold: the Budget, authorised and not captured, off session (or with the client
   * present when the booking is made inside the lock).
   */
  async placeHold(input: {
    runId: string;
    /** The payment row of this attempt: one hold per row, whatever the retries. */
    paymentId: string;
    amountCents: number;
    customerId: string;
    paymentMethodId: string;
    chefAccountId: string;
    bookingId: string;
    bookingReference: string | null;
  }): Promise<HoldPlaced | HoldFailure> {
    try {
      const intent = await this.client().paymentIntents.create(
        {
          amount: input.amountCents,
          currency: 'eur',
          customer: input.customerId,
          payment_method: input.paymentMethodId,
          payment_method_types: ['card'],
          capture_method: 'manual',
          off_session: true,
          confirm: true,
          on_behalf_of: input.chefAccountId,
          transfer_data: { destination: input.chefAccountId },
          description: `Courses ${input.bookingReference ?? input.bookingId}`,
          metadata: {
            groceryRunId: input.runId,
            bookingId: input.bookingId,
            purpose: 'courses',
          },
          expand: ['latest_charge'],
        },
        { idempotencyKey: `grocery-hold-${input.paymentId}` },
      );
      if (intent.status !== 'requires_capture') {
        return {
          ok: false,
          code: intent.status,
          paymentIntentId: intent.id,
          needsAuthentication: intent.status === 'requires_action',
        };
      }
      const charge = intent.latest_charge as Stripe.Charge | null;
      const card = charge?.payment_method_details?.card as
        | (Stripe.Charge.PaymentMethodDetails.Card & { capture_before?: number })
        | undefined;
      return { ok: true, intent, captureBefore: card?.capture_before ?? null };
    } catch (error) {
      const failure = error as {
        code?: string;
        decline_code?: string;
        raw?: { payment_intent?: { id?: string } };
        payment_intent?: { id?: string };
      };
      const code = failure.decline_code ?? failure.code ?? 'card_error';
      return {
        ok: false,
        code,
        paymentIntentId:
          failure.payment_intent?.id ?? failure.raw?.payment_intent?.id ?? null,
        needsAuthentication: code === 'authentication_required',
      };
    }
  }

  /** One capture, of the exact total; the rest of the hold is released by Stripe. */
  async capture(intentId: string, amountCents: number, feeCents: number, runId: string) {
    return this.client().paymentIntents.capture(
      intentId,
      {
        amount_to_capture: amountCents,
        ...(feeCents > 0 ? { application_fee_amount: feeCents } : {}),
      },
      { idempotencyKey: `grocery-capture-${runId}` },
    );
  }

  /** The hold released whole: cancelled groceries, or nothing to reimburse. */
  async cancelHold(intentId: string, runId: string) {
    return this.client().paymentIntents.cancel(
      intentId,
      { cancellation_reason: 'requested_by_customer' },
      { idempotencyKey: `grocery-cancel-${runId}` },
    );
  }

  /**
   * A refund to the client, taken back from the chef's transfer: an upheld contest, or
   * the difference after a safety capture. The instant payout fee is not refunded.
   */
  async refund(input: { intentId: string; amountCents: number; key: string }) {
    return this.client().refunds.create(
      {
        payment_intent: input.intentId,
        amount: input.amountCents,
        reverse_transfer: true,
      },
      { idempotencyKey: `grocery-refund-${input.key}` },
    );
  }

  /** The chef's instant payout, on their connected account. */
  async instantPayout(input: { accountId: string; amountCents: number; runId: string }) {
    return this.client().payouts.create(
      {
        amount: input.amountCents,
        currency: 'eur',
        method: 'instant',
        description: 'Remboursement des courses',
        metadata: { groceryRunId: input.runId },
      },
      { stripeAccount: input.accountId, idempotencyKey: `grocery-payout-${input.runId}` },
    );
  }

  /** The instant payout failed: its fee goes back to the chef. */
  async refundInstantFee(intentId: string, runId: string) {
    const intent = await this.client().paymentIntents.retrieve(intentId, {
      expand: ['latest_charge'],
    });
    const feeId = idOf((intent.latest_charge as Stripe.Charge | null)?.application_fee);
    if (!feeId) return null;
    return this.client().applicationFees.createRefund(
      feeId,
      {},
      { idempotencyKey: `grocery-fee-refund-${runId}` },
    );
  }

  /** A lost chargeback the chef was at fault for: taken back from their transfer. */
  async reverseTransfer(input: { intentId: string; amountCents: number; key: string }) {
    const intent = await this.client().paymentIntents.retrieve(input.intentId, {
      expand: ['latest_charge'],
    });
    const transferId = idOf((intent.latest_charge as Stripe.Charge | null)?.transfer);
    if (!transferId) {
      throw new ServiceUnavailableException({
        code: 'TRANSFER_NOT_FOUND',
        message: 'This payment has no transfer to the batch cooker to take back.',
      });
    }
    return this.client().transfers.createReversal(
      transferId,
      { amount: input.amountCents, metadata: { reason: 'grocery_dispute' } },
      { idempotencyKey: `grocery-reversal-${input.key}` },
    );
  }
}
