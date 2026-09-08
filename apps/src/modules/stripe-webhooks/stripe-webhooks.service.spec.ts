import { ServiceUnavailableException } from '@nestjs/common';
import type Stripe from 'stripe';

import { StripeService } from '../../integrations/stripe.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CommissionDebitsService } from '../payments/commission-debits.service';
import { PaymentsService } from '../payments/payments.service';
import { SepaMandatesService } from '../payments/sepa-mandates.service';
import { StripeConnectService } from '../payments/stripe-connect.service';
import { StripeWebhooksService } from './stripe-webhooks.service';

let eventCounter = 0;

function event(type: string, object: unknown): Stripe.Event {
  eventCounter += 1;
  return {
    id: `evt_${eventCounter}`,
    type,
    data: { object },
  } as unknown as Stripe.Event;
}

const COMMISSION_DEBIT = { id: 'debit-1', commissionInvoiceId: 'invoice-1' };

describe('StripeWebhooksService', () => {
  let payments: {
    handlePaymentIntentSucceeded: jest.Mock;
    handlePaymentIntentFailed: jest.Mock;
    handleChargeRefunded: jest.Mock;
  };
  let stripeConnect: { handleAccountUpdated: jest.Mock };
  let sepaMandates: { handleSetupIntentSucceeded: jest.Mock };
  let commissionDebits: {
    findDebitByPaymentIntentId: jest.Mock;
    handleDebitProcessing: jest.Mock;
    handleDebitSucceeded: jest.Mock;
    handleDebitFailed: jest.Mock;
    handleDebitDisputed: jest.Mock;
    handleDebitDisputeClosed: jest.Mock;
    handleMandateUpdated: jest.Mock;
  };
  let prisma: { stripeEventLog: { upsert: jest.Mock; update: jest.Mock } };
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
    commissionDebits = {
      // Default: the intent is not a commission debit, so events route to the client flow.
      findDebitByPaymentIntentId: jest.fn().mockResolvedValue(null),
      handleDebitProcessing: jest.fn(),
      handleDebitSucceeded: jest.fn(),
      handleDebitFailed: jest.fn(),
      handleDebitDisputed: jest.fn(),
      handleDebitDisputeClosed: jest.fn(),
      handleMandateUpdated: jest.fn(),
    };
    prisma = {
      stripeEventLog: {
        upsert: jest.fn().mockResolvedValue({ id: 'log-1', processedAt: null }),
        update: jest.fn(),
      },
    };
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
      commissionDebits as unknown as CommissionDebitsService,
      prisma as unknown as PrismaService,
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

    it('sends a commission debit succeeding to the debit engine, never to a client payment', async () => {
      // Both flows produce PaymentIntents on the platform account; only a database lookup
      // tells them apart. Routing this to `handlePaymentIntentSucceeded` would settle an
      // unrelated client payment and confirm someone else's booking.
      commissionDebits.findDebitByPaymentIntentId.mockResolvedValue(COMMISSION_DEBIT);

      await service.handleVerifiedEvent(
        event('payment_intent.succeeded', { id: 'pi_debit' }),
      );

      expect(commissionDebits.handleDebitSucceeded).toHaveBeenCalledWith(
        COMMISSION_DEBIT,
      );
      expect(payments.handlePaymentIntentSucceeded).not.toHaveBeenCalled();
    });

    it('sends a commission debit failing to the debit engine', async () => {
      commissionDebits.findDebitByPaymentIntentId.mockResolvedValue(COMMISSION_DEBIT);

      await service.handleVerifiedEvent(
        event('payment_intent.payment_failed', { id: 'pi_debit' }),
      );

      expect(commissionDebits.handleDebitFailed).toHaveBeenCalledWith(COMMISSION_DEBIT, {
        id: 'pi_debit',
      });
      expect(payments.handlePaymentIntentFailed).not.toHaveBeenCalled();
    });

    it('routes payment_intent.processing to the debit engine only', async () => {
      commissionDebits.findDebitByPaymentIntentId.mockResolvedValue(COMMISSION_DEBIT);

      await service.handleVerifiedEvent(
        event('payment_intent.processing', { id: 'pi_debit' }),
      );

      expect(commissionDebits.handleDebitProcessing).toHaveBeenCalledWith(
        COMMISSION_DEBIT,
      );
    });

    it('ignores payment_intent.processing on a client payment', async () => {
      await service.handleVerifiedEvent(
        event('payment_intent.processing', { id: 'pi_1' }),
      );

      expect(commissionDebits.handleDebitProcessing).not.toHaveBeenCalled();
      expect(payments.handlePaymentIntentSucceeded).not.toHaveBeenCalled();
    });

    it('routes a dispute through its PaymentIntent, not through metadata', async () => {
      // A `Dispute` carries an empty `metadata`, so metadata-based routing would drop
      // exactly the event that reopens a commission receivable.
      commissionDebits.findDebitByPaymentIntentId.mockResolvedValue(COMMISSION_DEBIT);

      await service.handleVerifiedEvent(
        event('charge.dispute.created', {
          id: 'dp_1',
          payment_intent: 'pi_debit',
          metadata: {},
        }),
      );

      expect(commissionDebits.findDebitByPaymentIntentId).toHaveBeenCalledWith(
        'pi_debit',
      );
      expect(commissionDebits.handleDebitDisputed).toHaveBeenCalledWith(COMMISSION_DEBIT);
    });

    it('ignores a dispute on a client card charge', async () => {
      await service.handleVerifiedEvent(
        event('charge.dispute.created', { id: 'dp_1', payment_intent: 'pi_client' }),
      );

      expect(commissionDebits.handleDebitDisputed).not.toHaveBeenCalled();
    });

    it('routes charge.dispute.closed with the dispute itself', async () => {
      commissionDebits.findDebitByPaymentIntentId.mockResolvedValue(COMMISSION_DEBIT);
      const dispute = { id: 'dp_1', payment_intent: 'pi_debit', status: 'won' };

      await service.handleVerifiedEvent(event('charge.dispute.closed', dispute));

      expect(commissionDebits.handleDebitDisputeClosed).toHaveBeenCalledWith(
        COMMISSION_DEBIT,
        dispute,
      );
    });

    it('routes mandate.updated', async () => {
      await service.handleVerifiedEvent(
        event('mandate.updated', { id: 'mandate_1', status: 'inactive' }),
      );

      expect(commissionDebits.handleMandateUpdated).toHaveBeenCalledWith({
        id: 'mandate_1',
        status: 'inactive',
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

    it('skips an event already marked processed', async () => {
      prisma.stripeEventLog.upsert.mockResolvedValue({
        id: 'log-1',
        processedAt: new Date(),
      });
      constructEvent.mockReturnValue(event('charge.refunded', { id: 'ch_1' }));

      await service.verifyAndHandle('{"id":"evt_1"}', 'sig');

      expect(payments.handleChargeRefunded).not.toHaveBeenCalled();
    });

    it('replays an event whose row exists but was never processed', async () => {
      // The guard reads `processedAt`, not the row: a handler that threw on the first
      // delivery has already inserted its row, and an existence check would mistake
      // Stripe's retry for a duplicate and lose the event for good.
      prisma.stripeEventLog.upsert.mockResolvedValue({
        id: 'log-1',
        processedAt: null,
        error: 'boom',
      });
      constructEvent.mockReturnValue(event('charge.refunded', { id: 'ch_1' }));

      await service.verifyAndHandle('{"id":"evt_1"}', 'sig');

      expect(payments.handleChargeRefunded).toHaveBeenCalledWith({ id: 'ch_1' });
      expect(prisma.stripeEventLog.update).toHaveBeenCalledWith({
        where: { id: 'log-1' },
        data: expect.objectContaining({ processedAt: expect.any(Date), error: null }),
      });
    });

    it('records the failure and rethrows so Stripe retries', async () => {
      constructEvent.mockReturnValue(event('charge.refunded', { id: 'ch_1' }));
      payments.handleChargeRefunded.mockRejectedValue(new Error('database down'));

      await expect(service.verifyAndHandle('{"id":"evt_1"}', 'sig')).rejects.toThrow(
        'database down',
      );
      expect(prisma.stripeEventLog.update).toHaveBeenCalledWith({
        where: { id: 'log-1' },
        data: { error: 'database down' },
      });
      expect(prisma.stripeEventLog.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ processedAt: expect.any(Date) }),
        }),
      );
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
