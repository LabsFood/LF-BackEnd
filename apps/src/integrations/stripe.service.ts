import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly client: Stripe | null;
  readonly apiKey?: string;
  readonly webhookSecret?: string;
  readonly connectWebhookSecret?: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('stripe.secretKey');
    this.webhookSecret = config.get<string>('stripe.webhookSecret');
    this.connectWebhookSecret = config.get<string>('stripe.connectWebhookSecret');
    this.client = this.apiKey ? new Stripe(this.apiKey, { typescript: true }) : null;
    if (!this.client) {
      this.logger.warn('Stripe is not configured (STRIPE_SECRET_KEY missing).');
    }
  }

  get configured(): boolean {
    return this.client !== null;
  }

  /**
   * Signing secrets a webhook delivery may have been signed with, deduplicated.
   *
   * A Connect platform needs two endpoints in the Stripe Dashboard — one scoped to
   * "Your account" (destination charges, refunds, setup intents) and one to
   * "Connected accounts" (`account.updated`) — and Stripe issues each its own signing
   * secret even when both point at the same URL. The Stripe CLI collapses this to a
   * single secret locally, which is why the split only bites in a deployed
   * environment.
   */
  get webhookSecrets(): string[] {
    const secrets = [this.webhookSecret, this.connectWebhookSecret].filter(
      (secret): secret is string => typeof secret === 'string' && secret.length > 0,
    );
    return [...new Set(secrets)];
  }

  getClient(): Stripe {
    if (!this.client) {
      throw new Error('Stripe is not configured.');
    }
    return this.client;
  }
}
