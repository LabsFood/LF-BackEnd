import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly client: Stripe | null;
  readonly apiKey?: string;
  readonly webhookSecret?: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('stripe.secretKey');
    this.webhookSecret = config.get<string>('stripe.webhookSecret');
    this.client = this.apiKey ? new Stripe(this.apiKey, { typescript: true }) : null;
    if (!this.client) {
      this.logger.warn('Stripe is not configured (STRIPE_SECRET_KEY missing).');
    }
  }

  get configured(): boolean {
    return this.client !== null;
  }

  getClient(): Stripe {
    if (!this.client) {
      throw new Error('Stripe is not configured.');
    }
    return this.client;
  }
}
