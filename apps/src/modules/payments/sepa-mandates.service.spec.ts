import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import type Stripe from 'stripe';

import { StripeService } from '../../integrations/stripe.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { SepaMandatesService } from './sepa-mandates.service';

describe('SepaMandatesService', () => {
  let prisma: {
    chefProfile: { findUnique: jest.Mock };
    sepaMandate: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      upsert: jest.Mock;
      update: jest.Mock;
    };
  };
  let stripeClient: {
    customers: { create: jest.Mock };
    setupIntents: { create: jest.Mock };
    paymentMethods: { retrieve: jest.Mock };
  };
  let stripe: { configured: boolean; getClient: jest.Mock };
  let users: { ensurePersistedFromClerk: jest.Mock };
  let service: SepaMandatesService;

  beforeEach(() => {
    prisma = {
      chefProfile: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'chef-1', displayName: 'Chef Marie D.' }),
      },
      sepaMandate: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
      },
    };
    stripeClient = {
      customers: { create: jest.fn().mockResolvedValue({ id: 'cus_1' }) },
      setupIntents: {
        create: jest
          .fn()
          .mockResolvedValue({ id: 'seti_1', client_secret: 'seti_1_secret' }),
      },
      paymentMethods: {
        retrieve: jest.fn().mockResolvedValue({ sepa_debit: { last4: '3000' } }),
      },
    };
    stripe = { configured: true, getClient: jest.fn(() => stripeClient) };
    users = {
      ensurePersistedFromClerk: jest
        .fn()
        .mockResolvedValue({ id: 'user-1', email: 'chef@example.com' }),
    };

    service = new SepaMandatesService(
      prisma as unknown as PrismaService,
      stripe as unknown as StripeService,
      users as unknown as UsersService,
    );
  });

  describe('createSetupIntent', () => {
    it('creates a customer and a sepa_debit SetupIntent, and records it as pending', async () => {
      await expect(service.createSetupIntent('clerk_1')).resolves.toEqual({
        clientSecret: 'seti_1_secret',
      });

      expect(stripeClient.setupIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_1',
          payment_method_types: ['sepa_debit'],
        }),
      );
      expect(prisma.sepaMandate.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { chefProfileId: 'chef-1' },
          create: expect.objectContaining({
            chefProfileId: 'chef-1',
            stripeCustomerId: 'cus_1',
            stripeSetupIntentId: 'seti_1',
            status: 'pending',
          }),
        }),
      );
    });

    it('reuses the Stripe customer from a previous mandate attempt', async () => {
      prisma.sepaMandate.findUnique.mockResolvedValue({
        stripeCustomerId: 'cus_existing',
      });

      await service.createSetupIntent('clerk_1');

      expect(stripeClient.customers.create).not.toHaveBeenCalled();
      expect(stripeClient.setupIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({ customer: 'cus_existing' }),
      );
    });

    it('requires a chef profile', async () => {
      prisma.chefProfile.findUnique.mockResolvedValue(null);

      await expect(service.createSetupIntent('clerk_1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('is unavailable when Stripe has no secret key', async () => {
      stripe.configured = false;

      await expect(service.createSetupIntent('clerk_1')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });

  describe('handleSetupIntentSucceeded', () => {
    it('activates the mandate and stores the masked IBAN', async () => {
      prisma.sepaMandate.findFirst.mockResolvedValue({
        id: 'mandate-1',
        status: 'pending',
      });

      await service.handleSetupIntentSucceeded({
        id: 'seti_1',
        payment_method: 'pm_1',
        mandate: 'mandate_stripe_1',
      } as unknown as Stripe.SetupIntent);

      expect(stripeClient.paymentMethods.retrieve).toHaveBeenCalledWith('pm_1');
      expect(prisma.sepaMandate.update).toHaveBeenCalledWith({
        where: { id: 'mandate-1' },
        data: expect.objectContaining({
          status: 'active',
          stripePaymentMethodId: 'pm_1',
          stripeMandateId: 'mandate_stripe_1',
          ibanLast4: '3000',
        }),
      });
    });

    it('reads the IBAN from an expanded payment method without a second API call', async () => {
      prisma.sepaMandate.findFirst.mockResolvedValue({
        id: 'mandate-1',
        status: 'pending',
      });

      await service.handleSetupIntentSucceeded({
        id: 'seti_1',
        payment_method: { id: 'pm_1', sepa_debit: { last4: '1234' } },
        mandate: { id: 'mandate_stripe_1' },
      } as unknown as Stripe.SetupIntent);

      expect(stripeClient.paymentMethods.retrieve).not.toHaveBeenCalled();
      expect(prisma.sepaMandate.update).toHaveBeenCalledWith({
        where: { id: 'mandate-1' },
        data: expect.objectContaining({ ibanLast4: '1234' }),
      });
    });

    it('is a no-op when the mandate is already active', async () => {
      prisma.sepaMandate.findFirst.mockResolvedValue({
        id: 'mandate-1',
        status: 'active',
      });

      await service.handleSetupIntentSucceeded({
        id: 'seti_1',
        payment_method: 'pm_1',
      } as unknown as Stripe.SetupIntent);

      expect(prisma.sepaMandate.update).not.toHaveBeenCalled();
    });

    it('ignores a SetupIntent with no local mandate row', async () => {
      prisma.sepaMandate.findFirst.mockResolvedValue(null);

      await service.handleSetupIntentSucceeded({
        id: 'seti_unknown',
      } as unknown as Stripe.SetupIntent);

      expect(prisma.sepaMandate.update).not.toHaveBeenCalled();
    });
  });
});
