import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type Stripe from 'stripe';

import { StripeService } from '../../integrations/stripe.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CommissionDebitsService } from '../payments/commission-debits.service';
import { idOf, PaymentsService } from '../payments/payments.service';
import { SepaMandatesService } from '../payments/sepa-mandates.service';
import { StripeConnectService } from '../payments/stripe-connect.service';

@Injectable()
export class StripeWebhooksService {
  private readonly logger = new Logger(StripeWebhooksService.name);

  constructor(
    private readonly stripe: StripeService,
    private readonly payments: PaymentsService,
    private readonly stripeConnect: StripeConnectService,
    private readonly sepaMandates: SepaMandatesService,
    private readonly commissionDebits: CommissionDebitsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Dispatch.
   *
   * Two different money flows now produce PaymentIntents on the platform account: a
   * client paying for a booking, and the platform debiting a chef's commission. They are
   * told apart by a **lookup in `commission_debits`**, never by `metadata` — a
   * `charge.dispute.created` carries a `Dispute` whose `metadata` is empty, and a
   * `Mandate` has no `metadata` at all, so metadata-based routing silently misfiles
   * exactly the events that matter most.
   */
  async handleVerifiedEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'payment_intent.processing':
      case 'payment_intent.succeeded':
      case 'payment_intent.payment_failed': {
        // The one lookup that separates the two flows, done once for all three events.
        const debit = await this.commissionDebits.findDebitByPaymentIntentId(
          event.data.object.id,
        );
        if (event.type === 'payment_intent.processing') {
          // Only the SEPA side has anything to record here; a card intent passes straight
          // through `processing` and the client flow learns nothing from it.
          if (debit) await this.commissionDebits.handleDebitProcessing(debit);
          return;
        }
        if (event.type === 'payment_intent.succeeded') {
          if (debit) await this.commissionDebits.handleDebitSucceeded(debit);
          else await this.payments.handlePaymentIntentSucceeded(event.data.object);
          return;
        }
        // SEPA has no `failed` PaymentIntent status: a late failure surfaces as the
        // intent falling back to `requires_payment_method`, days after acceptance.
        if (debit) await this.commissionDebits.handleDebitFailed(debit, event.data.object);
        else await this.payments.handlePaymentIntentFailed(event.data.object);
        return;
      }
      case 'charge.dispute.created': {
        const debit = await this.debitForDispute(event.data.object);
        if (debit) {
          await this.commissionDebits.handleDebitDisputed(debit);
        }
        return;
      }
      case 'charge.dispute.closed': {
        const debit = await this.debitForDispute(event.data.object);
        if (debit) {
          await this.commissionDebits.handleDebitDisputeClosed(debit, event.data.object);
        }
        return;
      }
      case 'charge.refunded':
        await this.payments.handleChargeRefunded(event.data.object);
        return;
      case 'account.updated':
        await this.stripeConnect.handleAccountUpdated(event.data.object);
        return;
      case 'setup_intent.succeeded':
        await this.sepaMandates.handleSetupIntentSucceeded(event.data.object);
        return;
      case 'mandate.updated':
        await this.commissionDebits.handleMandateUpdated(event.data.object);
        return;
      default:
        this.logger.debug(`Ignored Stripe webhook type: ${event.type}`);
    }
  }

  /**
   * A dispute points at its PaymentIntent directly, so the same lookup routes it. A
   * dispute on a client's card charge is not this engine's business and falls through.
   */
  private async debitForDispute(dispute: Stripe.Dispute) {
    const paymentIntentId = idOf(dispute.payment_intent);
    if (!paymentIntentId) {
      this.logger.warn(`Dispute ${dispute.id} carries no PaymentIntent; ignoring.`);
      return null;
    }
    return this.commissionDebits.findDebitByPaymentIntentId(paymentIntentId);
  }

  /**
   * Verifies the `stripe-signature` header against the raw request bytes, then
   * dispatches. Handlers are idempotent because Stripe delivers each event at least
   * once and retries anything that does not return 2xx.
   *
   * Each configured signing secret is tried in turn. A Connect platform serves two
   * Dashboard endpoints on this one URL — "Your account" (payments, refunds, setup
   * intents) and "Connected accounts" (`account.updated`) — and Stripe signs each with
   * its own secret. Verifying against only the first would reject every delivery from
   * the other, silently stranding chefs at `chargesEnabled: false`.
   */
  async verifyAndHandle(rawBody: string, signature: string): Promise<void> {
    if (!this.stripe.configured) {
      throw new ServiceUnavailableException(
        'Stripe is not configured (STRIPE_SECRET_KEY missing).',
      );
    }
    const secrets = this.stripe.webhookSecrets;
    if (secrets.length === 0) {
      throw new ServiceUnavailableException(
        'Stripe webhooks are not configured (STRIPE_WEBHOOK_SECRET missing).',
      );
    }

    const client = this.stripe.getClient();
    let event: Stripe.Event | undefined;
    let lastError: unknown;
    for (const secret of secrets) {
      try {
        event = client.webhooks.constructEvent(rawBody, signature, secret);
        break;
      } catch (error) {
        // Wrong secret for this endpoint — try the next one before giving up.
        lastError = error;
      }
    }
    if (!event) {
      throw lastError;
    }

    if (event.account) {
      this.logger.debug(
        `Stripe event ${event.type} from connected account ${event.account}`,
      );
    }
    await this.dispatchOnce(event);
  }

  /**
   * De-duplication ledger around the dispatch.
   *
   * The guard reads **`processedAt`**, not whether the row exists. A handler that throws
   * has already written its row, so an existence check would read Stripe's retry — the
   * one chance to get the event right — as a duplicate and drop it for good. Failures are
   * recorded and rethrown so the endpoint answers non-2xx and Stripe does retry.
   */
  private async dispatchOnce(event: Stripe.Event): Promise<void> {
    const log = await this.prisma.stripeEventLog.upsert({
      where: { eventId: event.id },
      update: {},
      create: { eventId: event.id, type: event.type },
    });
    if (log.processedAt) {
      this.logger.debug(
        `Stripe event ${event.id} already processed; ignoring the retry.`,
      );
      return;
    }

    try {
      await this.handleVerifiedEvent(event);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      await this.prisma.stripeEventLog.update({
        where: { id: log.id },
        data: { error: message },
      });
      throw error;
    }

    await this.prisma.stripeEventLog.update({
      where: { id: log.id },
      data: { processedAt: new Date(), error: null },
    });
  }
}
