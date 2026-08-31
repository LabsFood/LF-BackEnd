import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type Stripe from 'stripe';

import { StripeService } from '../../integrations/stripe.service';
import { PaymentsService } from '../payments/payments.service';
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
  ) {}

  async handleVerifiedEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.payments.handlePaymentIntentSucceeded(event.data.object);
        return;
      case 'payment_intent.payment_failed':
        await this.payments.handlePaymentIntentFailed(event.data.object);
        return;
      case 'charge.refunded':
        await this.payments.handleChargeRefunded(event.data.object);
        return;
      case 'account.updated':
        await this.stripeConnect.handleAccountUpdated(event.data.object);
        return;
      case 'setup_intent.succeeded':
        await this.sepaMandates.handleSetupIntentSucceeded(event.data.object);
        return;
      default:
        this.logger.debug(`Ignored Stripe webhook type: ${event.type}`);
    }
  }

  /**
   * Verifies the `stripe-signature` header against the raw request bytes, then
   * dispatches. Handlers are idempotent because Stripe delivers each event at least
   * once and retries anything that does not return 2xx.
   */
  async verifyAndHandle(rawBody: string, signature: string): Promise<void> {
    if (!this.stripe.configured) {
      throw new ServiceUnavailableException(
        'Stripe is not configured (STRIPE_SECRET_KEY missing).',
      );
    }
    const webhookSecret = this.stripe.webhookSecret;
    if (!webhookSecret) {
      throw new ServiceUnavailableException(
        'Stripe webhooks are not configured (STRIPE_WEBHOOK_SECRET missing).',
      );
    }

    const event = this.stripe
      .getClient()
      .webhooks.constructEvent(rawBody, signature, webhookSecret);
    await this.handleVerifiedEvent(event);
  }
}
