import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Stripe from 'stripe';

import { StripeService } from '../../integrations/stripe.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { PaymentsService } from './payments.service';

const CONNECT_READY_CHEF = {
  id: 'chef-1',
  stripeAccountId: 'acct_123',
  stripeChargesEnabled: true,
  stripePayoutsEnabled: true,
};

const PENDING_BOOKING = {
  id: 'booking-1',
  reference: 'LF-2026-0001',
  status: 'pending',
  amountTtc: 12_500,
  priceCents: 12_500,
  currency: 'EUR',
  chefProfile: CONNECT_READY_CHEF,
};

describe('PaymentsService', () => {
  let prisma: {
    booking: { findFirst: jest.Mock; update: jest.Mock };
    payment: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    commission: { updateMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let tx: {
    booking: { update: jest.Mock };
    payment: { create: jest.Mock; update: jest.Mock };
    commission: { updateMany: jest.Mock };
  };
  let stripeClient: {
    paymentIntents: { create: jest.Mock; retrieve: jest.Mock };
  };
  let stripe: { configured: boolean; getClient: jest.Mock };
  let users: { ensurePersistedFromClerk: jest.Mock };
  let service: PaymentsService;

  beforeEach(() => {
    tx = {
      booking: { update: jest.fn() },
      payment: {
        create: jest.fn().mockResolvedValue({ id: 'payment-1' }),
        update: jest.fn(),
      },
      commission: { updateMany: jest.fn() },
    };
    prisma = {
      booking: {
        findFirst: jest.fn().mockResolvedValue(PENDING_BOOKING),
        update: jest.fn(),
      },
      payment: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      commission: { updateMany: jest.fn() },
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

    const config = {
      get: jest.fn((key: string, fallback?: unknown) =>
        key === 'payments.commissionRateBps'
          ? 1500
          : key === 'payments.commissionVatRateBps'
            ? 2000
            : fallback,
      ),
    };

    service = new PaymentsService(
      prisma as unknown as PrismaService,
      stripe as unknown as StripeService,
      config as unknown as ConfigService,
      users as unknown as UsersService,
    );
  });

  describe('createIntentForBooking', () => {
    it('creates a destination charge with the commission as the application fee', async () => {
      const result = await service.createIntentForBooking('clerk_1', 'booking-1');

      expect(stripeClient.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 12_500,
          currency: 'eur',
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
        { get: jest.fn(() => 0) } as unknown as ConfigService,
        users as unknown as UsersService,
      );

      await service.createIntentForBooking('clerk_1', 'booking-1');

      const [args] = stripeClient.paymentIntents.create.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(args).not.toHaveProperty('application_fee_amount');
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
        where: { paymentId: 'payment-1' },
        data: expect.objectContaining({ status: 'collected' }),
      });
      expect(tx.booking.update).toHaveBeenCalledWith({
        where: { id: 'booking-1' },
        data: { status: 'confirmed' },
      });
    });

    it('is a no-op on redelivery of an already-settled payment', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        id: 'payment-1',
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
