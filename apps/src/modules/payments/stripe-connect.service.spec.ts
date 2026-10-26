import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Stripe from 'stripe';

import { StripeService } from '../../integrations/stripe.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { StripeConnectService } from './stripe-connect.service';

describe('StripeConnectService', () => {
  let prisma: {
    chefProfile: { findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
  };
  let stripeClient: {
    accounts: { create: jest.Mock; createLoginLink: jest.Mock };
    accountLinks: { create: jest.Mock };
  };
  let stripe: { configured: boolean; getClient: jest.Mock };
  let users: { ensurePersistedFromClerk: jest.Mock };
  let service: StripeConnectService;

  beforeEach(() => {
    prisma = {
      chefProfile: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'chef-1',
          stripeAccountId: null,
          stripeChargesEnabled: false,
          stripePayoutsEnabled: false,
          stripeDetailsSubmitted: false,
        }),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    stripeClient = {
      accounts: {
        create: jest.fn().mockResolvedValue({ id: 'acct_new' }),
        createLoginLink: jest
          .fn()
          .mockResolvedValue({ url: 'https://connect.stripe.com/express/abc' }),
      },
      accountLinks: {
        create: jest
          .fn()
          .mockResolvedValue({ url: 'https://connect.stripe.com/setup/e/1' }),
      },
    };
    stripe = { configured: true, getClient: jest.fn(() => stripeClient) };
    users = {
      ensurePersistedFromClerk: jest
        .fn()
        .mockResolvedValue({ id: 'user-1', email: 'chef@example.com' }),
    };
    const config = {
      getOrThrow: jest.fn((key: string) =>
        key === 'payments.stripeConnectRefreshUrl'
          ? 'https://app.test/refresh'
          : 'https://app.test/return',
      ),
    };

    service = new StripeConnectService(
      prisma as unknown as PrismaService,
      stripe as unknown as StripeService,
      config as unknown as ConfigService,
      users as unknown as UsersService,
    );
  });

  describe('createOnboardingLink', () => {
    it('creates a French Express account on first use and stores its id', async () => {
      const result = await service.createOnboardingLink('clerk_1');

      expect(stripeClient.accounts.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'express',
          country: 'FR',
          email: 'chef@example.com',
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
        }),
      );
      expect(prisma.chefProfile.update).toHaveBeenCalledWith({
        where: { id: 'chef-1' },
        data: { stripeAccountId: 'acct_new' },
      });
      expect(result).toEqual({ url: 'https://connect.stripe.com/setup/e/1' });
    });

    it('reuses the existing account on a second call', async () => {
      prisma.chefProfile.findUnique.mockResolvedValue({
        id: 'chef-1',
        stripeAccountId: 'acct_existing',
      });

      await service.createOnboardingLink('clerk_1');

      expect(stripeClient.accounts.create).not.toHaveBeenCalled();
      expect(stripeClient.accountLinks.create).toHaveBeenCalledWith(
        expect.objectContaining({ account: 'acct_existing', type: 'account_onboarding' }),
      );
    });

    it('requires a chef profile', async () => {
      prisma.chefProfile.findUnique.mockResolvedValue(null);

      await expect(service.createOnboardingLink('clerk_1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('is unavailable when Stripe has no secret key', async () => {
      stripe.configured = false;

      await expect(service.createOnboardingLink('clerk_1')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });

  describe('createDashboardLink', () => {
    it('opens the Express dashboard once the onboarding form is submitted', async () => {
      prisma.chefProfile.findUnique.mockResolvedValue({
        id: 'chef-1',
        stripeAccountId: 'acct_1',
        stripeDetailsSubmitted: true,
      });

      await expect(service.createDashboardLink('clerk_1')).resolves.toEqual({
        url: 'https://connect.stripe.com/express/abc',
      });
      expect(stripeClient.accounts.createLoginLink).toHaveBeenCalledWith('acct_1');
    });

    it('refuses before onboarding is submitted', async () => {
      prisma.chefProfile.findUnique.mockResolvedValue({
        id: 'chef-1',
        stripeAccountId: 'acct_1',
        stripeDetailsSubmitted: false,
      });

      await expect(service.createDashboardLink('clerk_1')).rejects.toMatchObject({
        response: { code: 'STRIPE_ONBOARDING_INCOMPLETE' },
      });
      expect(stripeClient.accounts.createLoginLink).not.toHaveBeenCalled();
    });
  });

  it('reports the mirrored onboarding flags', async () => {
    prisma.chefProfile.findUnique.mockResolvedValue({
      id: 'chef-1',
      stripeAccountId: 'acct_1',
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      stripeDetailsSubmitted: true,
    });

    await expect(service.getStatus('clerk_1')).resolves.toEqual({
      stripeAccountId: 'acct_1',
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
  });

  describe('handleAccountUpdated', () => {
    it('copies the Stripe flags onto the matching chef profile', async () => {
      await service.handleAccountUpdated({
        id: 'acct_1',
        charges_enabled: true,
        payouts_enabled: false,
        details_submitted: true,
      } as unknown as Stripe.Account);

      expect(prisma.chefProfile.updateMany).toHaveBeenCalledWith({
        where: { stripeAccountId: 'acct_1' },
        data: {
          stripeChargesEnabled: true,
          stripePayoutsEnabled: false,
          stripeDetailsSubmitted: true,
        },
      });
    });

    it('ignores an account this platform does not know', async () => {
      prisma.chefProfile.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.handleAccountUpdated({ id: 'acct_unknown' } as unknown as Stripe.Account),
      ).resolves.toBeUndefined();
    });
  });
});
