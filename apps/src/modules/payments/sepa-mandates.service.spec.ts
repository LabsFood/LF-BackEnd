import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Stripe from 'stripe';

import { StripeService } from '../../integrations/stripe.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ChefDocumentsService } from '../chef-onboarding/services/chef-documents.service';
import { UsersService } from '../users/users.service';
import { CommissionDebitsService } from './commission-debits.service';
import { SepaMandatesService } from './sepa-mandates.service';

const RETURN_URL = 'https://batchcooking.labsfood.fr/espace-chef/remuneration';

/** A SetupIntent as Checkout leaves it once the chef has signed. */
const SIGNED_INTENT = {
  id: 'seti_1',
  status: 'succeeded',
  payment_method: 'pm_1',
  mandate: 'mandate_1',
  metadata: { chefProfileId: 'chef-1' },
} as unknown as Stripe.SetupIntent;

describe('SepaMandatesService', () => {
  let prisma: {
    chefProfile: { findUnique: jest.Mock; findUniqueOrThrow: jest.Mock };
    sepaMandate: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      upsert: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let stripeClient: {
    rawRequest: jest.Mock;
    customers: { create: jest.Mock };
    setupIntents: { create: jest.Mock; retrieve: jest.Mock };
    paymentMethods: { retrieve: jest.Mock };
    mandates: { retrieve: jest.Mock };
    checkout: { sessions: { create: jest.Mock; retrieve: jest.Mock } };
  };
  let stripe: { configured: boolean; getClient: jest.Mock };
  let documents: { recordSystemDocument: jest.Mock };
  let commissionDebits: { collectOutstanding: jest.Mock };
  let service: SepaMandatesService;

  beforeEach(() => {
    prisma = {
      chefProfile: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'chef-1',
          displayName: 'Chef Marie D.',
          stripeAccountId: null,
        }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          displayName: 'Chef Marie D.',
          user: { email: 'chef@example.com' },
        }),
      },
      sepaMandate: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    stripeClient = {
      rawRequest: jest.fn().mockResolvedValue({}),
      customers: { create: jest.fn().mockResolvedValue({ id: 'cus_1' }) },
      setupIntents: {
        create: jest
          .fn()
          .mockResolvedValue({ id: 'seti_1', client_secret: 'seti_1_secret' }),
        retrieve: jest.fn().mockResolvedValue(SIGNED_INTENT),
      },
      paymentMethods: {
        retrieve: jest.fn().mockResolvedValue({
          sepa_debit: { last4: '3000' },
          billing_details: { name: 'Marie Dupont', email: 'marie@example.com' },
        }),
      },
      mandates: {
        retrieve: jest.fn().mockResolvedValue({
          id: 'mandate_1',
          payment_method_details: { sepa_debit: { reference: 'RUM-2026-001' } },
          customer_acceptance: {
            accepted_at: 1_792_972_800,
            online: { ip_address: '203.0.113.7', user_agent: 'Mozilla/5.0' },
          },
        }),
      },
      checkout: {
        sessions: {
          create: jest.fn().mockResolvedValue({
            id: 'cs_test_1',
            url: 'https://checkout.stripe.com/c/1',
          }),
          retrieve: jest.fn().mockResolvedValue({
            id: 'cs_test_1',
            status: 'complete',
            metadata: { chefProfileId: 'chef-1' },
            setup_intent: SIGNED_INTENT,
          }),
        },
      },
    };
    stripe = { configured: true, getClient: jest.fn(() => stripeClient) };
    const users = {
      ensurePersistedFromClerk: jest
        .fn()
        .mockResolvedValue({ id: 'user-1', email: 'chef@example.com' }),
    };
    const config = {
      get: jest.fn(() => ['https://batchcooking.labsfood.fr']),
    };
    documents = { recordSystemDocument: jest.fn().mockResolvedValue({ id: 'doc-1' }) };
    commissionDebits = { collectOutstanding: jest.fn() };

    service = new SepaMandatesService(
      prisma as unknown as PrismaService,
      stripe as unknown as StripeService,
      users as unknown as UsersService,
      config as unknown as ConfigService,
      documents as unknown as ChefDocumentsService,
      commissionDebits as unknown as CommissionDebitsService,
    );
  });

  describe('createCheckoutSession', () => {
    it('opens a Stripe setup page for a SEPA debit, tagged with the chef', async () => {
      await expect(service.createCheckoutSession('clerk_1', RETURN_URL)).resolves.toEqual(
        {
          url: 'https://checkout.stripe.com/c/1',
        },
      );

      const [params] = stripeClient.checkout.sessions.create.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(params).toMatchObject({
        mode: 'setup',
        payment_method_types: ['sepa_debit'],
        customer: 'cus_1',
        metadata: { chefProfileId: 'chef-1' },
        setup_intent_data: { metadata: { chefProfileId: 'chef-1' } },
        cancel_url: `${RETURN_URL}?mandat=annule`,
      });
      // Stripe's placeholder has to reach it unencoded.
      expect(params.success_url).toBe(
        `${RETURN_URL}?mandat=signe&session_id={CHECKOUT_SESSION_ID}`,
      );
      expect(prisma.sepaMandate.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: {
            chefProfileId: 'chef-1',
            stripeCustomerId: 'cus_1',
            status: 'pending',
          },
        }),
      );
    });

    it('keeps a new customer even when the Stripe page fails, so a retry reuses it', async () => {
      stripeClient.checkout.sessions.create.mockRejectedValue(
        Object.assign(new Error('Invalid request'), {
          type: 'StripeInvalidRequestError',
          statusCode: 400,
        }),
      );

      await expect(
        service.createCheckoutSession('clerk_1', RETURN_URL),
      ).rejects.toMatchObject({ response: { code: 'STRIPE_UNAVAILABLE' } });

      expect(prisma.sepaMandate.upsert).toHaveBeenCalledWith({
        where: { chefProfileId: 'chef-1' },
        update: { stripeCustomerId: 'cus_1' },
        create: { chefProfileId: 'chef-1', stripeCustomerId: 'cus_1', status: 'pending' },
      });
    });

    it('signs on the chef’s connected account once they have one (Accounts v2)', async () => {
      prisma.chefProfile.findUnique.mockResolvedValue({
        id: 'chef-1',
        displayName: 'Chef Marie D.',
        stripeAccountId: 'acct_1',
      });

      await service.createCheckoutSession('clerk_1', RETURN_URL);

      expect(stripeClient.customers.create).not.toHaveBeenCalled();
      expect(stripeClient.rawRequest).toHaveBeenCalledWith(
        'POST',
        '/v2/core/accounts/acct_1',
        { configuration: { customer: {} } },
        { apiVersion: '2026-09-30.endive' },
      );
      const [params, options] = stripeClient.checkout.sessions.create.mock.calls[0] as [
        Record<string, unknown>,
        Record<string, unknown>,
      ];
      expect(params).toMatchObject({ customer_account: 'acct_1' });
      expect(params).not.toHaveProperty('customer');
      expect(options).toEqual({ apiVersion: '2026-09-30.endive' });
    });

    it('keeps an active mandate in force while the chef signs a new one', async () => {
      prisma.sepaMandate.findUnique.mockResolvedValue({
        status: 'active',
        stripeCustomerId: 'cus_existing',
      });

      await service.createCheckoutSession('clerk_1', RETURN_URL);

      expect(stripeClient.customers.create).not.toHaveBeenCalled();
      expect(prisma.sepaMandate.upsert).not.toHaveBeenCalled();
    });

    it('refuses to send the chef back anywhere but our own sites', async () => {
      await expect(
        service.createCheckoutSession('clerk_1', 'https://evil.example/steal'),
      ).rejects.toMatchObject({ response: { code: 'RETURN_URL_NOT_ALLOWED' } });
      expect(stripeClient.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('is unavailable when Stripe has no secret key', async () => {
      stripe.configured = false;

      await expect(
        service.createCheckoutSession('clerk_1', RETURN_URL),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('confirmCheckout', () => {
    beforeEach(() => {
      prisma.sepaMandate.findUnique.mockResolvedValue({
        id: 'mandate-row-1',
        status: 'pending',
        stripeSetupIntentId: null,
        ibanLast4: null,
        signedAt: null,
      });
    });

    it('activates the mandate, files it in the dossier and debits what is due', async () => {
      await service.confirmCheckout('clerk_1', 'cs_test_1');

      expect(prisma.sepaMandate.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'mandate-row-1' }),
          data: {
            status: 'active',
            stripeSetupIntentId: 'seti_1',
            stripePaymentMethodId: 'pm_1',
            stripeMandateId: 'mandate_1',
            ibanLast4: '3000',
            signedAt: new Date(1_792_972_800 * 1000),
          },
        }),
      );
      const [chefProfileId, type, file, metadata] = documents.recordSystemDocument.mock
        .calls[0] as [
        string,
        string,
        { bytes: Buffer; fileName: string; mimeType: string },
        Record<string, unknown>,
      ];
      expect(chefProfileId).toBe('chef-1');
      expect(type).toBe('sepa_mandate');
      expect(file.mimeType).toBe('application/pdf');
      expect(file.fileName).toBe('mandat-sepa-RUM-2026-001.pdf');
      // The content itself is checked in sepa-mandate-document.spec.ts.
      expect(file.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(metadata).toEqual({ stripeMandateId: 'mandate_1' });
      expect(commissionDebits.collectOutstanding).toHaveBeenCalledWith('chef-1');
    });

    it('does nothing twice: the webhook got there first', async () => {
      prisma.sepaMandate.findUnique.mockResolvedValue({
        id: 'mandate-row-1',
        status: 'active',
        stripeSetupIntentId: 'seti_1',
      });

      await service.confirmCheckout('clerk_1', 'cs_test_1');

      expect(prisma.sepaMandate.updateMany).not.toHaveBeenCalled();
      expect(documents.recordSystemDocument).not.toHaveBeenCalled();
      expect(commissionDebits.collectOutstanding).not.toHaveBeenCalled();
    });

    it('only lets a later signature replace the active one, so a late retry cannot', async () => {
      await service.confirmCheckout('clerk_1', 'cs_test_1');

      const [{ where }] = prisma.sepaMandate.updateMany.mock.calls[0] as [
        { where: { OR: Record<string, unknown>[] } },
      ];
      expect(where.OR).toEqual([
        { status: { not: 'active' } },
        { signedAt: null },
        { signedAt: { lt: new Date(1_792_972_800 * 1000) } },
      ]);
    });

    it('lets only one of two simultaneous activations file and debit', async () => {
      prisma.sepaMandate.updateMany.mockResolvedValue({ count: 0 });

      await service.confirmCheckout('clerk_1', 'cs_test_1');

      expect(documents.recordSystemDocument).not.toHaveBeenCalled();
      expect(commissionDebits.collectOutstanding).not.toHaveBeenCalled();
    });

    it('still debits when the dossier copy cannot be stored', async () => {
      documents.recordSystemDocument.mockRejectedValue(new Error('bucket down'));

      await expect(
        service.confirmCheckout('clerk_1', 'cs_test_1'),
      ).resolves.toBeDefined();
      expect(commissionDebits.collectOutstanding).toHaveBeenCalledWith('chef-1');
    });

    it('answers 404 for another chef’s session, like for one that does not exist', async () => {
      stripeClient.checkout.sessions.retrieve.mockResolvedValue({
        id: 'cs_test_1',
        status: 'complete',
        metadata: { chefProfileId: 'chef-2' },
        setup_intent: SIGNED_INTENT,
      });

      await expect(
        service.confirmCheckout('clerk_1', 'cs_test_1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.sepaMandate.updateMany).not.toHaveBeenCalled();
    });

    it('refuses a page the chef left without signing', async () => {
      stripeClient.checkout.sessions.retrieve.mockResolvedValue({
        id: 'cs_test_1',
        status: 'open',
        metadata: { chefProfileId: 'chef-1' },
        setup_intent: null,
      });

      await expect(service.confirmCheckout('clerk_1', 'cs_test_1')).rejects.toMatchObject(
        {
          response: { code: 'MANDATE_NOT_SIGNED' },
        },
      );
    });
  });

  describe('handleSetupIntentSucceeded', () => {
    it('finds a Checkout mandate by the chef it was tagged with', async () => {
      prisma.sepaMandate.findUnique.mockResolvedValue({
        id: 'mandate-row-1',
        status: 'pending',
        stripeSetupIntentId: null,
      });

      await service.handleSetupIntentSucceeded(SIGNED_INTENT);

      expect(prisma.sepaMandate.findUnique).toHaveBeenCalledWith({
        where: { chefProfileId: 'chef-1' },
      });
      expect(prisma.sepaMandate.updateMany).toHaveBeenCalled();
    });

    it('ignores a SetupIntent that is not a commission mandate', async () => {
      await service.handleSetupIntentSucceeded({
        ...SIGNED_INTENT,
        metadata: {},
      } as unknown as Stripe.SetupIntent);

      expect(prisma.sepaMandate.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('createSetupIntent (deprecated)', () => {
    it('still records an Elements SetupIntent as pending', async () => {
      await expect(service.createSetupIntent('clerk_1')).resolves.toEqual({
        clientSecret: 'seti_1_secret',
      });
      expect(prisma.sepaMandate.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            stripeCustomerId: 'cus_1',
            stripeSetupIntentId: 'seti_1',
            status: 'pending',
          }),
        }),
      );
    });

    it('requires a chef profile', async () => {
      prisma.chefProfile.findUnique.mockResolvedValue(null);

      await expect(service.createSetupIntent('clerk_1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
});
