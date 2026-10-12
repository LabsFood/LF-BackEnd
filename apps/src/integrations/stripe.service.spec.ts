import { ConfigService } from '@nestjs/config';

import { StripeService } from './stripe.service';

function serviceWith(values: Record<string, string | undefined>): StripeService {
  const config = { get: jest.fn((key: string) => values[key]) };
  return new StripeService(config as unknown as ConfigService);
}

describe('StripeService', () => {
  describe('webhookSecrets', () => {
    it('is empty when nothing is configured', () => {
      expect(serviceWith({}).webhookSecrets).toEqual([]);
    });

    it('tries the account secret first, then the Connect one', () => {
      const service = serviceWith({
        'stripe.webhookSecret': 'whsec_account',
        'stripe.connectWebhookSecret': 'whsec_connect',
      });

      expect(service.webhookSecrets).toEqual(['whsec_account', 'whsec_connect']);
    });

    it('deduplicates when both endpoints share a secret (Stripe CLI)', () => {
      const service = serviceWith({
        'stripe.webhookSecret': 'whsec_cli',
        'stripe.connectWebhookSecret': 'whsec_cli',
      });

      expect(service.webhookSecrets).toEqual(['whsec_cli']);
    });

    it('ignores an empty string from an unset env var', () => {
      const service = serviceWith({
        'stripe.webhookSecret': 'whsec_account',
        'stripe.connectWebhookSecret': '',
      });

      expect(service.webhookSecrets).toEqual(['whsec_account']);
    });

    it('works with only the Connect secret set', () => {
      const service = serviceWith({ 'stripe.connectWebhookSecret': 'whsec_connect' });

      expect(service.webhookSecrets).toEqual(['whsec_connect']);
    });
  });

  it('reports itself unconfigured without an API key', () => {
    expect(serviceWith({}).configured).toBe(false);
  });
});
