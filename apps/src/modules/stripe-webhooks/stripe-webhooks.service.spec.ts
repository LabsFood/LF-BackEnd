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
  let stripe: { configured: boolean; webhookSecret?: string; getClient: jest.Mock };
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
      webhookSecret: 'whsec_test',
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

    it('rejects when the webhook secret is missing', async () => {
      stripe.webhookSecret = undefined;

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

    it('verifies the raw body against the signature, then dispatches', async () => {
      constructEvent.mockReturnValue(event('payment_intent.succeeded', { id: 'pi_1' }));

      await service.verifyAndHandle('{"id":"evt_1"}', 'sig');

      expect(constructEvent).toHaveBeenCalledWith('{"id":"evt_1"}', 'sig', 'whsec_test');
      expect(payments.handlePaymentIntentSucceeded).toHaveBeenCalledWith({ id: 'pi_1' });
    });
  });
});
