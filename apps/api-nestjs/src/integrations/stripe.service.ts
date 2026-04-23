import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class StripeService {
  readonly secretKey?: string;

  /** Load the Stripe secret key from typed config at module init. */
  constructor(config: ConfigService) {
    this.secretKey = config.get<string>('stripe.secretKey');
  }

  /** Whether the Stripe secret key was provided via env. */
  get configured(): boolean {
    return Boolean(this.secretKey);
  }
}
