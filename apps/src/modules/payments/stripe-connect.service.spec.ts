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
    rawRequest: jest.Mock;
    accounts: { createLoginLink: jest.Mock };
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
      // Accounts v2 is reached through `rawRequest`: the account, then its onboarding link.
      rawRequest: jest.fn((_method: string, path: string) =>
        Promise.resolve(
          path === '/v2/core/account_links'
            ? { url: 'https://connect.stripe.com/setup/e/1' }
            : { id: 'acct_new' },
        ),
      ),
      accounts: {
        createLoginLink: jest
          .fn()
          .mockResolvedValue({ url: 'https://connect.stripe.com/express/abc' }),
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

      expect(stripeClient.rawRequest).toHaveBeenCalledWith(
        'POST',
        '/v2/core/accounts',
        expect.objectContaining({
          metadata: { chefProfileId: 'chef-1' },
          dashboard: 'express',
          identity: { country: 'fr' },
          configuration: {
            // No `recipient` yet: Stripe wants a contact e-mail with it, which only the
            // hosted onboarding may set for a platform in France.
            merchant: { capabilities: { card_payments: { requested: true } } },
            customer: {},
          },
        }),
        { apiVersion: '2026-09-30.endive' },
      );
      // A platform in France may send these only inside an account token.
      const [, , body] = stripeClient.rawRequest.mock.calls[0] as [
        string,
        string,
        Record<string, unknown>,
      ];
      expect(body).not.toHaveProperty('contact_email');
      expect(body).not.toHaveProperty('display_name');
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

      expect(stripeClient.rawRequest).not.toHaveBeenCalledWith(
        'POST',
        '/v2/core/accounts',
        expect.anything(),
        expect.anything(),
      );
      expect(stripeClient.rawRequest).toHaveBeenCalledWith(
        'POST',
        '/v2/core/account_links',
        expect.objectContaining({
          account: 'acct_existing',
          use_case: expect.objectContaining({ type: 'account_onboarding' }),
        }),
        { apiVersion: '2026-09-30.endive' },
      );
    });

    it('asks for everything Stripe will ever need in one go (upfront onboarding)', async () => {
      prisma.chefProfile.findUnique.mockResolvedValue({
        id: 'chef-1',
        stripeAccountId: 'acct_existing',
      });

      await service.createOnboardingLink('clerk_1');

      expect(stripeClient.rawRequest).toHaveBeenCalledWith(
        'POST',
        '/v2/core/account_links',
        expect.objectContaining({
          use_case: expect.objectContaining({
            account_onboarding: expect.objectContaining({
              collection_options: {
                fields: 'eventually_due',
                future_requirements: 'include',
              },
            }),
          }),
        }),
        expect.anything(),
      );
    });

    it('answers with a typed error, not Stripe’s message, when Stripe refuses', async () => {
      stripeClient.rawRequest.mockRejectedValue(
        Object.assign(new Error('Invalid email chef@example.com'), {
          type: 'StripeInvalidRequestError',
          code: 'parameter_invalid',
          statusCode: 400,
        }),
      );

      await expect(service.createOnboardingLink('clerk_1')).rejects.toMatchObject({
        response: { code: 'STRIPE_ACCOUNTS_V2_ERROR' },
      });
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

    it('adds the recipient configuration once onboarding gave the account an e-mail', async () => {
      await service.handleAccountUpdated({
        id: 'acct_1',
        email: 'chef@example.com',
        capabilities: { card_payments: 'active' },
      } as unknown as Stripe.Account);

      expect(stripeClient.rawRequest).toHaveBeenCalledWith(
        'POST',
        '/v2/core/accounts/acct_1',
        {
          configuration: {
            recipient: {
              capabilities: { stripe_balance: { stripe_transfers: { requested: true } } },
            },
          },
        },
        { apiVersion: '2026-09-30.endive' },
      );
    });

    it('leaves the configuration alone without an e-mail or once transfers exist', async () => {
      await service.handleAccountUpdated({ id: 'acct_1' } as unknown as Stripe.Account);
      await service.handleAccountUpdated({
        id: 'acct_1',
        email: 'chef@example.com',
        capabilities: { transfers: 'pending' },
      } as unknown as Stripe.Account);

      expect(stripeClient.rawRequest).not.toHaveBeenCalled();
    });

    it('ignores an account this platform does not know', async () => {
      prisma.chefProfile.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.handleAccountUpdated({ id: 'acct_unknown' } as unknown as Stripe.Account),
      ).resolves.toBeUndefined();
    });
  });
});
