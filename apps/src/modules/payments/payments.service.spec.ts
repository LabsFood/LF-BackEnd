import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Stripe from 'stripe';

import { StripeService } from '../../integrations/stripe.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { PaymentInvoicesService } from './payment-invoices.service';
import type { ChefPayoutsService } from './payouts/chef-payouts.service';
import { PaymentsService } from './payments.service';

const CONNECT_READY_CHEF = {
  id: 'chef-1',
  isActive: true,
  isVerified: true,
  stripeAccountId: 'acct_123',
  stripeChargesEnabled: true,
  stripePayoutsEnabled: true,
};

/** What `assertPayable` reads of the contract, for a booking made before the CGV V1. */
const PRE_V1_CONTRACT = {
  startsAt: new Date('2026-10-20T09:00:00Z'),
  createdAt: new Date('2026-10-01T09:00:00Z'),
  shoppingByClient: false,
  contractVersion: null,
  cgvAcceptedAt: null,
  deboursMandateAcceptedAt: null,
  earlyExecutionRequestedAt: null,
  serviceOffer: { shoppingIncluded: false },
};

const PENDING_BOOKING = {
  id: 'booking-1',
  reference: 'LF-2026-0001',
  status: 'pending',
  amountTtc: 12_500,
  priceCents: 12_500,
  currency: 'EUR',
  chefProfile: CONNECT_READY_CHEF,
  // Made before the CGV V1: the booking boxes are not asked of it.
  ...PRE_V1_CONTRACT,
};

describe('PaymentsService', () => {
  let prisma: {
    booking: { findFirst: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    payment: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      aggregate: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    commission: { findFirst: jest.Mock; updateMany: jest.Mock };
    commissionInvoice: { findFirst: jest.Mock };
    // No accepted offer and no saved rate: the environment default applies.
    quote: { findUnique: jest.Mock };
    platformSetting: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let tx: {
    booking: { findUnique: jest.Mock; update: jest.Mock };
    payment: { create: jest.Mock; update: jest.Mock; aggregate: jest.Mock };
    commission: { updateMany: jest.Mock };
  };
  let stripeClient: {
    paymentIntents: { create: jest.Mock; retrieve: jest.Mock };
  };
  let stripe: { configured: boolean; getClient: jest.Mock };
  let users: { ensurePersistedFromClerk: jest.Mock };
  let invoices: { issue: jest.Mock; archive: jest.Mock };
  let service: PaymentsService;
  let legacyOn: boolean;
  let payouts: { payCardNow: jest.Mock };

  /** Amount already settled on the booking, as the coverage sum sees it. */
  const covered = (amount: number) => ({ _sum: { amountTtc: amount } });

  beforeEach(() => {
    legacyOn = true;
    payouts = { payCardNow: jest.fn() };
    tx = {
      booking: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'booking-1',
          status: 'pending',
          amountTtc: 12_500,
          priceCents: 12_500,
        }),
        update: jest.fn(),
      },
      payment: {
        create: jest.fn().mockResolvedValue({ id: 'payment-1' }),
        update: jest.fn(),
        aggregate: jest.fn().mockResolvedValue(covered(12_500)),
      },
      commission: { updateMany: jest.fn() },
    };
    prisma = {
      booking: {
        findFirst: jest.fn().mockResolvedValue(PENDING_BOOKING),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        aggregate: jest.fn().mockResolvedValue(covered(0)),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        update: jest.fn(),
      },
      commission: { findFirst: jest.fn().mockResolvedValue(null), updateMany: jest.fn() },
      commissionInvoice: { findFirst: jest.fn().mockResolvedValue(null) },
      quote: { findUnique: jest.fn().mockResolvedValue(null) },
      platformSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    stripeClient = {
      paymentIntents: {
        create: jest.fn().mockResolvedValue({ id: 'pi_1', client_secret: 'pi_1_secret' }),
        retrieve: jest.fn(),
      },
    };
    stripe = { configured: true, getClient: jest.fn(() => stripeClient) };
    users = { ensurePersistedFromClerk: jest.fn().mockResolvedValue({ id: 'user-1' }) };
    invoices = {
      issue: jest
        .fn()
        .mockResolvedValue({ id: 'invoice-1', invoiceNumber: 'LF-CUS26-00001' }),
      archive: jest.fn().mockResolvedValue(undefined),
    };

    const get = jest.fn((key: string, fallback?: unknown) =>
      key === 'payments.commissionRateBps'
        ? 1500
        : key === 'payments.commissionVatRateBps'
          ? 2000
          : key === 'payments.commissionDebitMaxAttempts'
            ? 3
            : key === 'payments.legacyInvoicing'
              ? legacyOn
              : fallback,
    );
    const config = { get, getOrThrow: get };

    service = new PaymentsService(
      prisma as unknown as PrismaService,
      stripe as unknown as StripeService,
      config as unknown as ConfigService,
      users as unknown as UsersService,
      invoices as unknown as PaymentInvoicesService,
      payouts as unknown as ChefPayoutsService,
    );
  });

  describe('createIntentForBooking', () => {
    it('creates a destination charge with the commission as the application fee', async () => {
      const result = await service.createIntentForBooking('clerk_1', 'booking-1');

      expect(stripeClient.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 12_500,
          currency: 'eur',
          // The chef is merchant of record: invoice A is issued in their name.
          on_behalf_of: 'acct_123',
          transfer_data: { destination: 'acct_123' },
          application_fee_amount: 2250,
        }),
      );
      expect(result).toEqual({
        paymentId: 'payment-1',
        clientSecret: 'pi_1_secret',
        amountTtc: 12_500,
        currency: 'EUR',
        commissionTtc: 2250,
      });
      expect(tx.booking.update).toHaveBeenCalledWith({
        where: { id: 'booking-1' },
        data: { stripePaymentIntentId: 'pi_1' },
      });
    });

    it('charges on the SAS account at the net price when the former invoicing is off', async () => {
      legacyOn = false;

      await service.createIntentForBooking('clerk_1', 'booking-1');

      const [args] = stripeClient.paymentIntents.create.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(args).toEqual(
        expect.objectContaining({ amount: 12_500, transfer_group: 'booking-1' }),
      );
      expect(args).not.toHaveProperty('on_behalf_of');
      expect(args).not.toHaveProperty('transfer_data');
      expect(args).not.toHaveProperty('application_fee_amount');
      // 125 € TTC -> 113,64 € HT at 10 %, Labs Food part 18 % of HT, no VAT on it.
      expect(tx.payment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          commission: {
            create: expect.objectContaining({
              collectionMethod: 'payout_withholding',
              basisAmountCents: 11_364,
              vatRateBps: 0,
            }),
          },
        }),
      });
    });

    it('refuses to charge the card while a CESU declaration waits on the chef', async () => {
      // Not settled, so still inside `remaining`: charging it would cover it twice.
      prisma.payment.count.mockResolvedValue(1);

      await expect(
        service.createIntentForBooking('clerk_1', 'booking-1'),
      ).rejects.toMatchObject({ response: { code: 'CESU_PENDING' } });
      expect(stripeClient.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('freezes the rate and VAT on the commission row', async () => {
      await service.createIntentForBooking('clerk_1', 'booking-1');

      expect(tx.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            commission: {
              create: expect.objectContaining({
                chefProfileId: 'chef-1',
                rateBps: 1500,
                vatRateBps: 2000,
                amountHtCents: 1875,
                amountVatCents: 375,
                amountTtcCents: 2250,
                collectionMethod: 'stripe_application_fee',
                status: 'pending',
              }),
            },
          }),
        }),
      );
    });

    it('omits the application fee entirely when the commission rate is zero', async () => {
      service = new PaymentsService(
        prisma as unknown as PrismaService,
        stripe as unknown as StripeService,
        (() => {
          const g = jest.fn((key: string) =>
            key === 'payments.commissionDebitMaxAttempts'
              ? 3
              : key === 'payments.legacyInvoicing'
                ? true
                : 0,
          );
          return { get: g, getOrThrow: g };
        })() as unknown as ConfigService,
        users as unknown as UsersService,
        invoices as unknown as PaymentInvoicesService,
        payouts as unknown as ChefPayoutsService,
      );

      await service.createIntentForBooking('clerk_1', 'booking-1');

      const [args] = stripeClient.paymentIntents.create.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(args).not.toHaveProperty('application_fee_amount');
    });

    it.each([
      ['unverified', { isActive: true, isVerified: false }],
      ['deactivated', { isActive: false, isVerified: true }],
    ])('refuses to move money to a chef who is %s', async (_label, flags) => {
      // Connect-ready but not admin-approved: finishing Stripe onboarding is not vetting.
      prisma.booking.findFirst.mockResolvedValue({
        ...PENDING_BOOKING,
        chefProfile: { ...CONNECT_READY_CHEF, ...flags },
      });

      await expect(
        service.createIntentForBooking('clerk_1', 'booking-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(stripeClient.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('rejects a chef who has not finished Connect onboarding', async () => {
      prisma.booking.findFirst.mockResolvedValue({
        ...PENDING_BOOKING,
        chefProfile: { ...CONNECT_READY_CHEF, stripePayoutsEnabled: false },
      });

      await expect(
        service.createIntentForBooking('clerk_1', 'booking-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(stripeClient.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('rejects a booking that is no longer pending', async () => {
      prisma.booking.findFirst.mockResolvedValue({
        ...PENDING_BOOKING,
        status: 'confirmed',
      });

      await expect(
        service.createIntentForBooking('clerk_1', 'booking-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('404s on a booking owned by someone else', async () => {
      prisma.booking.findFirst.mockResolvedValue(null);

      await expect(
        service.createIntentForBooking('clerk_1', 'booking-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('reuses a still-confirmable intent instead of creating a second one', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: 'payment-existing',
        amountTtc: 12_500,
        currency: 'EUR',
        stripePaymentIntentId: 'pi_existing',
        commission: { amountTtcCents: 2250 },
      });
      stripeClient.paymentIntents.retrieve.mockResolvedValue({
        id: 'pi_existing',
        status: 'requires_payment_method',
        client_secret: 'pi_existing_secret',
      });

      const result = await service.createIntentForBooking('clerk_1', 'booking-1');

      expect(result.paymentId).toBe('payment-existing');
      expect(result.clientSecret).toBe('pi_existing_secret');
      expect(stripeClient.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('refuses to charge again when the pending intent already succeeded', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: 'payment-existing',
        amountTtc: 12_500,
        currency: 'EUR',
        stripePaymentIntentId: 'pi_existing',
        commission: { amountTtcCents: 2250 },
      });
      stripeClient.paymentIntents.retrieve.mockResolvedValue({
        id: 'pi_existing',
        status: 'succeeded',
        client_secret: 'pi_existing_secret',
      });

      await expect(
        service.createIntentForBooking('clerk_1', 'booking-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(stripeClient.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('charges only what is left once part of the booking was paid in CESU', async () => {
      // 6 000 already settled in CESU on a 12 500 booking: charging the full amount again
      // would overcharge the client.
      prisma.payment.aggregate.mockResolvedValue(covered(6_000));

      const result = await service.createIntentForBooking('clerk_1', 'booking-1');

      expect(stripeClient.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 6_500, application_fee_amount: 1170 }),
      );
      expect(result.amountTtc).toBe(6_500);
    });

    it('computes the commission on the charged part, not on the booking total', async () => {
      prisma.payment.aggregate.mockResolvedValue(covered(6_000));

      await service.createIntentForBooking('clerk_1', 'booking-1');

      expect(tx.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amountTtc: 6_500,
            commission: {
              create: expect.objectContaining({ basisAmountCents: 6_500 }),
            },
          }),
        }),
      );
    });

    it('refuses a booking already covered by other payments', async () => {
      prisma.payment.aggregate.mockResolvedValue(covered(12_500));

      await expect(
        service.createIntentForBooking('clerk_1', 'booking-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(stripeClient.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('refuses a chef with an uncollectable commission invoice', async () => {
      prisma.commissionInvoice.findFirst.mockResolvedValue({
        invoiceNumber: 'LF-COM-2026-0007',
      });

      const refusal = service.createIntentForBooking('clerk_1', 'booking-1');

      await expect(refusal).rejects.toMatchObject({
        response: { code: 'CHEF_UNAVAILABLE' },
      });
      // The chef's unpaid invoice is not the paying client's business.
      await expect(refusal).rejects.not.toThrow(/LF-COM-2026-0007/);
      expect(stripeClient.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('retires a pending attempt whose amount no longer matches what is due', async () => {
      prisma.payment.aggregate.mockResolvedValue(covered(6_000));
      prisma.payment.findFirst.mockResolvedValue({
        id: 'payment-stale',
        amountTtc: 12_500,
        currency: 'EUR',
        stripePaymentIntentId: 'pi_stale',
        commission: { amountTtcCents: 2250 },
      });
      stripeClient.paymentIntents.retrieve.mockResolvedValue({
        id: 'pi_stale',
        status: 'requires_payment_method',
        client_secret: 'pi_stale_secret',
      });

      const result = await service.createIntentForBooking('clerk_1', 'booking-1');

      expect(tx.payment.update).toHaveBeenCalledWith({
        where: { id: 'payment-stale' },
        data: expect.objectContaining({ status: 'failed' }),
      });
      expect(result.paymentId).toBe('payment-1');
      expect(stripeClient.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 6_500 }),
      );
    });

    it('leaves a pending attempt alone when Stripe could not be reached', async () => {
      // Stripe has not said this intent is dead; retiring it here would orphan a payment
      // that may still succeed and arrive by webhook.
      prisma.payment.findFirst.mockResolvedValue({
        id: 'payment-existing',
        amountTtc: 12_500,
        currency: 'EUR',
        stripePaymentIntentId: 'pi_existing',
        commission: { amountTtcCents: 2250 },
      });
      stripeClient.paymentIntents.retrieve.mockRejectedValue(new Error('network down'));

      await service.createIntentForBooking('clerk_1', 'booking-1');

      expect(tx.payment.update).not.toHaveBeenCalled();
    });

    it('creates a fresh intent when the pending one was cancelled', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: 'payment-existing',
        amountTtc: 12_500,
        currency: 'EUR',
        stripePaymentIntentId: 'pi_existing',
        commission: { amountTtcCents: 2250 },
      });
      stripeClient.paymentIntents.retrieve.mockResolvedValue({
        id: 'pi_existing',
        status: 'canceled',
        client_secret: null,
      });

      const result = await service.createIntentForBooking('clerk_1', 'booking-1');

      expect(stripeClient.paymentIntents.create).toHaveBeenCalled();
      expect(result.paymentId).toBe('payment-1');
    });
  });

  describe('handlePaymentIntentSucceeded', () => {
    const intent = {
      id: 'pi_1',
      latest_charge: 'ch_1',
    } as unknown as Stripe.PaymentIntent;

    it('settles payment, commission, and booking together', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        id: 'payment-1',
        purpose: 'service',
        bookingId: 'booking-1',
        status: 'pending',
        amountTtc: 12_500,
      });

      await service.handlePaymentIntentSucceeded(intent);

      expect(tx.payment.update).toHaveBeenCalledWith({
        where: { id: 'payment-1' },
        data: expect.objectContaining({
          status: 'succeeded',
          stripeChargeId: 'ch_1',
          taxCreditEligibleAmount: 12_500,
        }),
      });
      expect(tx.commission.updateMany).toHaveBeenCalledWith({
        where: { paymentId: 'payment-1', collectionMethod: 'stripe_application_fee' },
        data: expect.objectContaining({ status: 'collected' }),
      });
      expect(tx.booking.update).toHaveBeenCalledWith({
        where: { id: 'booking-1' },
        data: { status: 'confirmed', concludedAt: expect.any(Date) },
      });
    });

    it('numbers invoice A inside the settlement, then stores its PDF', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        id: 'payment-1',
        purpose: 'service',
        bookingId: 'booking-1',
        status: 'pending',
        amountTtc: 12_500,
      });

      await service.handlePaymentIntentSucceeded(intent);

      // Same transaction client as the settlement: no settled payment without invoice.
      expect(invoices.issue).toHaveBeenCalledWith(tx, 'payment-1', expect.any(Date));
      expect(invoices.archive).toHaveBeenCalledWith('invoice-1');
      expect(invoices.issue.mock.invocationCallOrder[0]).toBeLessThan(
        invoices.archive.mock.invocationCallOrder[0],
      );
    });

    it('invoices in the SAS name and pays the batch cooker when the former invoicing is off', async () => {
      legacyOn = false;
      prisma.payment.findUnique.mockResolvedValue({
        id: 'payment-1',
        purpose: 'service',
        bookingId: 'booking-1',
        status: 'pending',
        amountTtc: 12_500,
      });

      await service.handlePaymentIntentSucceeded(intent);

      // Same issue call: the service picks the SAS as seller from the flag.
      expect(invoices.issue).toHaveBeenCalledWith(tx, 'payment-1', expect.any(Date));
      expect(invoices.archive).toHaveBeenCalledWith('invoice-1');
      expect(tx.booking.update).toHaveBeenCalled();
      // The net goes to the batch cooker right after the charge, with its autofacture.
      expect(payouts.payCardNow).toHaveBeenCalledWith('payment-1');
    });

    it('leaves the booking pending while the payments do not cover it', async () => {
      // A card payment that only settles part of a mixed CESU + card booking.
      prisma.payment.findUnique.mockResolvedValue({
        id: 'payment-1',
        purpose: 'service',
        bookingId: 'booking-1',
        status: 'pending',
        amountTtc: 6_500,
      });
      tx.payment.aggregate.mockResolvedValue(covered(6_500));

      await service.handlePaymentIntentSucceeded(intent);

      expect(tx.payment.update).toHaveBeenCalledWith({
        where: { id: 'payment-1' },
        data: expect.objectContaining({ status: 'succeeded' }),
      });
      expect(tx.booking.update).not.toHaveBeenCalled();
    });

    it('is a no-op on redelivery of an already-settled payment', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        id: 'payment-1',
        purpose: 'service',
        bookingId: 'booking-1',
        status: 'succeeded',
        amountTtc: 12_500,
      });

      await service.handlePaymentIntentSucceeded(intent);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('ignores an intent with no local payment row', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);

      await service.handlePaymentIntentSucceeded(intent);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('handlePaymentIntentFailed', () => {
    const intent = {
      id: 'pi_1',
      last_payment_error: { message: 'Your card was declined.' },
    } as unknown as Stripe.PaymentIntent;

    it('fails the payment and its commission, leaving the booking pending', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        id: 'payment-1',
        purpose: 'service',
        bookingId: 'booking-1',
        status: 'pending',
      });

      await service.handlePaymentIntentFailed(intent);

      expect(tx.payment.update).toHaveBeenCalledWith({
        where: { id: 'payment-1' },
        data: { status: 'failed', failureReason: 'Your card was declined.' },
      });
      expect(tx.commission.updateMany).toHaveBeenCalledWith({
        where: { paymentId: 'payment-1' },
        data: { status: 'failed' },
      });
      expect(tx.booking.update).not.toHaveBeenCalled();
    });

    it('never downgrades a payment Stripe already settled', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        id: 'payment-1',
        purpose: 'service',
        bookingId: 'booking-1',
        status: 'succeeded',
      });

      await service.handlePaymentIntentFailed(intent);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('handleChargeRefunded', () => {
    it('marks a full refund and leaves the commission collected', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: 'payment-1',
        status: 'succeeded',
        stripeChargeId: 'ch_1',
        refundedAmount: null,
      });

      await service.handleChargeRefunded({
        id: 'ch_1',
        amount: 12_500,
        amount_refunded: 12_500,
        payment_intent: 'pi_1',
      } as unknown as Stripe.Charge);

      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'payment-1' },
        data: expect.objectContaining({ status: 'refunded', refundedAmount: 12_500 }),
      });
      expect(prisma.commission.updateMany).not.toHaveBeenCalled();
    });

    it('marks a partial refund', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: 'payment-1',
        status: 'succeeded',
        stripeChargeId: 'ch_1',
        refundedAmount: null,
      });

      await service.handleChargeRefunded({
        id: 'ch_1',
        amount: 12_500,
        amount_refunded: 5_000,
        payment_intent: 'pi_1',
      } as unknown as Stripe.Charge);

      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'payment-1' },
        data: expect.objectContaining({
          status: 'partially_refunded',
          refundedAmount: 5_000,
        }),
      });
    });

    it('falls back to the payment intent id when the charge id is unknown', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: 'payment-1',
        status: 'succeeded',
        stripeChargeId: null,
        refundedAmount: null,
      });

      await service.handleChargeRefunded({
        id: 'ch_new',
        amount: 12_500,
        amount_refunded: 12_500,
        payment_intent: { id: 'pi_1' },
      } as unknown as Stripe.Charge);

      expect(prisma.payment.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [{ stripeChargeId: 'ch_new' }, { stripePaymentIntentId: 'pi_1' }],
        },
      });
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'payment-1' },
        data: expect.objectContaining({ stripeChargeId: 'ch_new' }),
      });
    });

    it('is a no-op when the refund was already recorded', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: 'payment-1',
        status: 'refunded',
        stripeChargeId: 'ch_1',
        refundedAmount: 12_500,
      });

      await service.handleChargeRefunded({
        id: 'ch_1',
        amount: 12_500,
        amount_refunded: 12_500,
        payment_intent: 'pi_1',
      } as unknown as Stripe.Charge);

      expect(prisma.payment.update).not.toHaveBeenCalled();
    });
  });
});
