import { ServiceUnavailableException } from '@nestjs/common';
import type Stripe from 'stripe';

import { StripeService } from '../../integrations/stripe.service';
import { PaymentsService } from '../payments/payments.service';
import { SepaMandatesService } from '../payments/sepa-mandates.service';
import { StripeConnectService } from '../payments/stripe-connect.service';
import { StripeWebhooksService } from './stripe-webhooks.service';

function event(type: string, object: unknown): Stripe.Event {
  return { type, data: { object } } as unknown as Stripe.Event;
}

describe('StripeWebhooksService', () => {
  let payments: {
    handlePaymentIntentSucceeded: jest.Mock;
    handlePaymentIntentFailed: jest.Mock;
    handleChargeRefunded: jest.Mock;
  };
  let stripeConnect: { handleAccountUpdated: jest.Mock };
  let sepaMandates: { handleSetupIntentSucceeded: jest.Mock };
  let constructEvent: jest.Mock;
  let stripe: { configured: boolean; webhookSecrets: string[]; getClient: jest.Mock };
  let service: StripeWebhooksService;

  beforeEach(() => {
    payments = {
      handlePaymentIntentSucceeded: jest.fn(),
      handlePaymentIntentFailed: jest.fn(),
      handleChargeRefunded: jest.fn(),
    };
    stripeConnect = { handleAccountUpdated: jest.fn() };
    sepaMandates = { handleSetupIntentSucceeded: jest.fn() };
    constructEvent = jest.fn();
    stripe = {
      configured: true,
      webhookSecrets: ['whsec_account'],
      getClient: jest.fn(() => ({ webhooks: { constructEvent } })),
    };

    service = new StripeWebhooksService(
      stripe as unknown as StripeService,
      payments as unknown as PaymentsService,
      stripeConnect as unknown as StripeConnectService,
      sepaMandates as unknown as SepaMandatesService,
    );
  });

  describe('handleVerifiedEvent', () => {
    it('routes payment_intent.succeeded', async () => {
      await service.handleVerifiedEvent(
        event('payment_intent.succeeded', { id: 'pi_1' }),
      );
      expect(payments.handlePaymentIntentSucceeded).toHaveBeenCalledWith({ id: 'pi_1' });
    });

    it('routes payment_intent.payment_failed', async () => {
      await service.handleVerifiedEvent(
        event('payment_intent.payment_failed', { id: 'pi_1' }),
      );
      expect(payments.handlePaymentIntentFailed).toHaveBeenCalledWith({ id: 'pi_1' });
    });

    it('routes charge.refunded', async () => {
      await service.handleVerifiedEvent(event('charge.refunded', { id: 'ch_1' }));
      expect(payments.handleChargeRefunded).toHaveBeenCalledWith({ id: 'ch_1' });
    });

    it('routes account.updated', async () => {
      await service.handleVerifiedEvent(event('account.updated', { id: 'acct_1' }));
      expect(stripeConnect.handleAccountUpdated).toHaveBeenCalledWith({ id: 'acct_1' });
    });

    it('routes setup_intent.succeeded', async () => {
      await service.handleVerifiedEvent(
        event('setup_intent.succeeded', { id: 'seti_1' }),
      );
      expect(sepaMandates.handleSetupIntentSucceeded).toHaveBeenCalledWith({
        id: 'seti_1',
      });
    });

    it('ignores unsubscribed event types', async () => {
      await service.handleVerifiedEvent(event('invoice.paid', { id: 'in_1' }));

      expect(payments.handlePaymentIntentSucceeded).not.toHaveBeenCalled();
      expect(stripeConnect.handleAccountUpdated).not.toHaveBeenCalled();
      expect(sepaMandates.handleSetupIntentSucceeded).not.toHaveBeenCalled();
    });
  });

  describe('verifyAndHandle', () => {
    it('rejects when Stripe has no secret key', async () => {
      stripe.configured = false;

      await expect(service.verifyAndHandle('{}', 'sig')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('rejects when no webhook secret is configured', async () => {
      stripe.webhookSecrets = [];

      await expect(service.verifyAndHandle('{}', 'sig')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('propagates a signature verification failure', async () => {
      constructEvent.mockImplementation(() => {
        throw new Error('No signatures found matching the expected signature.');
      });

      await expect(service.verifyAndHandle('{}', 'bad-sig')).rejects.toThrow(
        'No signatures found',
      );
    });

    it('falls back to the Connect secret when the account secret does not match', async () => {
      // Two Dashboard endpoints share this URL; `account.updated` is signed with the
      // Connect endpoint's secret, which is not the first one tried.
      stripe.webhookSecrets = ['whsec_account', 'whsec_connect'];
      constructEvent.mockImplementation((_body: string, _sig: string, secret: string) => {
        if (secret !== 'whsec_connect') {
          throw new Error('No signatures found matching the expected signature.');
        }
        return event('account.updated', { id: 'acct_1' });
      });

      await service.verifyAndHandle('{"id":"evt_1"}', 'sig');

      expect(constructEvent).toHaveBeenCalledTimes(2);
      expect(stripeConnect.handleAccountUpdated).toHaveBeenCalledWith({ id: 'acct_1' });
    });

    it('stops at the first secret that verifies', async () => {
      stripe.webhookSecrets = ['whsec_account', 'whsec_connect'];
      constructEvent.mockReturnValue(event('charge.refunded', { id: 'ch_1' }));

      await service.verifyAndHandle('{"id":"evt_1"}', 'sig');

      expect(constructEvent).toHaveBeenCalledTimes(1);
    });

    it('rejects when the signature matches none of the configured secrets', async () => {
      stripe.webhookSecrets = ['whsec_account', 'whsec_connect'];
      constructEvent.mockImplementation(() => {
        throw new Error('No signatures found matching the expected signature.');
      });

      await expect(service.verifyAndHandle('{}', 'bad-sig')).rejects.toThrow(
        'No signatures found',
      );
      expect(constructEvent).toHaveBeenCalledTimes(2);
      expect(payments.handleChargeRefunded).not.toHaveBeenCalled();
    });

    it('verifies the raw body against the signature, then dispatches', async () => {
      constructEvent.mockReturnValue(event('payment_intent.succeeded', { id: 'pi_1' }));

      await service.verifyAndHandle('{"id":"evt_1"}', 'sig');

      expect(constructEvent).toHaveBeenCalledWith(
        '{"id":"evt_1"}',
        'sig',
        'whsec_account',
      );
      expect(payments.handlePaymentIntentSucceeded).toHaveBeenCalledWith({ id: 'pi_1' });
    });
  });
});
