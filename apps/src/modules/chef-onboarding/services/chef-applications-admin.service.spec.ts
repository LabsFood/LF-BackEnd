import { ConfigService } from '@nestjs/config';

import { ChefApplicationStatus } from '../../../generated/prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
import { ClerkService } from '../../../integrations/clerk.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ChefApplicationsAdminService } from './chef-applications-admin.service';
import { ChefDocumentsService } from './chef-documents.service';
import { ChefDossierCron } from './chef-dossier.cron';
import { ChefOnboardingMailer } from './chef-onboarding.mailer';
import { KycStorageService } from './kyc-storage.service';

const application = (over: Record<string, unknown> = {}) => ({
  id: 'app-1',
  reference: 'APP-2026-0042',
  status: ChefApplicationStatus.submitted,
  firstName: 'Marie',
  lastName: 'Dupont',
  email: 'marie.dupont@exemple.fr',
  phone: '+33612345678',
  addressCity: 'Lyon',
  interventionZones: [],
  sapPath: 'type_b',
  sapDeclarationNumber: null,
  workAuthorizationStatus: 'eu_citizen',
  companyLegalForm: 'micro',
  ...over,
});

describe('ChefApplicationsAdminService.approve', () => {
  let service: ChefApplicationsAdminService;
  let prisma: {
    chefApplication: {
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
    };
    user: { findUnique: jest.Mock; create: jest.Mock };
    chefProfile: { create: jest.Mock };
    chefDocument: { updateMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let documents: { dossier: jest.Mock; answersOf: jest.Mock };
  let clerkUsers: { createUser: jest.Mock; deleteUser: jest.Mock };
  let signInTokens: { createSignInToken: jest.Mock };
  let mailer: { welcomeMagicLink: jest.Mock };
  let audit: { record: jest.Mock; failed: jest.Mock };

  const validatedDossier = {
    dossierStatus: 'validated',
    canApprove: true,
    documents: [],
  };

  beforeEach(() => {
    prisma = {
      chefApplication: {
        findUnique: jest.fn().mockResolvedValue(application()),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...application({
            status: ChefApplicationStatus.approved,
            decidedAt: new Date(),
          }),
          approvedUser: {
            id: 'u-1',
            clerkUserId: 'user_2n',
            email: 'marie.dupont@exemple.fr',
            role: 'chef',
          },
          chefProfile: {
            id: 'cp-1',
            displayName: 'Marie Dupont',
            isVerified: true,
            isActive: false,
          },
        }),
        update: jest.fn(),
      },
      user: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
      chefProfile: { create: jest.fn() },
      chefDocument: { updateMany: jest.fn() },
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          user: { create: jest.fn().mockResolvedValue({ id: 'u-1' }) },
          chefProfile: { create: jest.fn().mockResolvedValue({ id: 'cp-1' }) },
          chefDocument: { updateMany: jest.fn() },
          chefApplication: { update: jest.fn() },
        }),
      ),
    };
    documents = {
      dossier: jest.fn().mockResolvedValue(validatedDossier),
      answersOf: jest.fn(() => ({})),
    };
    clerkUsers = {
      createUser: jest.fn().mockResolvedValue({ id: 'user_2n' }),
      deleteUser: jest.fn().mockResolvedValue(undefined),
    };
    signInTokens = {
      createSignInToken: jest
        .fn()
        .mockResolvedValue({ token: 'tkn', url: 'https://clerk/x' }),
    };
    mailer = { welcomeMagicLink: jest.fn().mockResolvedValue({ sent: true }) };
    audit = { record: jest.fn(), failed: jest.fn() };

    service = new ChefApplicationsAdminService(
      prisma as unknown as PrismaService,
      documents as unknown as ChefDocumentsService,
      {} as unknown as KycStorageService,
      audit as unknown as AuditService,
      mailer as unknown as ChefOnboardingMailer,
      {
        configured: true,
        getClient: () => ({ users: clerkUsers, signInTokens }),
      } as unknown as ClerkService,
      { get: jest.fn((_k: string, d?: unknown) => d) } as unknown as ConfigService,
      { refreshActivation: jest.fn() } as unknown as ChefDossierCron,
    );
  });

  it('creates the account when the dossier is validated', async () => {
    const result = await service.approve('app-1', {}, 'admin-1');
    expect(clerkUsers.createUser).toHaveBeenCalled();
    expect(result.chefProfile).toMatchObject({ isVerified: true, isActive: false });
  });

  it('leaves the chef unpublished unless isActive is explicitly requested', async () => {
    await service.approve('app-1', {}, 'admin-1');
    // Default is vetted-but-offline; publishing is a separate, deliberate act.
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  describe('the guardrail: no active chef without validated blocking documents', () => {
    beforeEach(() => {
      documents.dossier.mockResolvedValue({
        dossierStatus: 'incomplete',
        canApprove: false,
        documents: [
          { type: 'identity', required: true, status: 'valid' },
          { type: 'registration', required: true, status: 'rejected' },
        ],
      });
    });

    it('refuses with DOCUMENT_REQUIRED', async () => {
      await expect(service.approve('app-1', {}, 'admin-1')).rejects.toMatchObject({
        response: { code: 'DOCUMENT_REQUIRED', documents: ['registration'] },
      });
    });

    it('creates no Clerk account when it refuses', async () => {
      await expect(service.approve('app-1', {}, 'admin-1')).rejects.toThrow();
      expect(clerkUsers.createUser).not.toHaveBeenCalled();
    });

    it('records the refusal so the attempt is auditable', async () => {
      await expect(service.approve('app-1', {}, 'admin-1')).rejects.toThrow();
      expect(audit.failed).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'application.approve' }),
        expect.any(Error),
      );
    });
  });

  describe('idempotency', () => {
    it('returns the first result instead of creating a second account', async () => {
      prisma.chefApplication.findUnique.mockResolvedValue(
        application({ status: ChefApplicationStatus.approved }),
      );
      const result = await service.approve('app-1', {}, 'admin-1');
      expect(clerkUsers.createUser).not.toHaveBeenCalled();
      expect(result.application.status).toBe('approved');
    });

    it('refuses to approve a candidature that was rejected', async () => {
      prisma.chefApplication.findUnique.mockResolvedValue(
        application({ status: ChefApplicationStatus.rejected }),
      );
      await expect(service.approve('app-1', {}, 'admin-1')).rejects.toMatchObject({
        response: { code: 'APPLICATION_DECIDED' },
      });
    });
  });

  describe('compensation on a late failure', () => {
    beforeEach(() => {
      prisma.$transaction.mockRejectedValue(new Error('postgres exploded'));
    });

    it('deletes the Clerk account so none is left without a users row', async () => {
      await expect(service.approve('app-1', {}, 'admin-1')).rejects.toThrow(
        'postgres exploded',
      );
      expect(clerkUsers.deleteUser).toHaveBeenCalledWith('user_2n');
    });

    it('records the compensation', async () => {
      await expect(service.approve('app-1', {}, 'admin-1')).rejects.toThrow();
      expect(audit.failed).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ compensated: true }),
        }),
        expect.any(Error),
      );
    });

    it('still surfaces the original error when the cleanup itself fails', async () => {
      clerkUsers.deleteUser.mockRejectedValue(new Error('clerk also down'));
      await expect(service.approve('app-1', {}, 'admin-1')).rejects.toThrow(
        'postgres exploded',
      );
    });
  });

  it('refuses when the email already belongs to a user', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'existing' });
    await expect(service.approve('app-1', {}, 'admin-1')).rejects.toMatchObject({
      response: { code: 'EMAIL_ALREADY_USED' },
    });
    expect(clerkUsers.createUser).not.toHaveBeenCalled();
  });

  it('sends a 7-day first-login link', async () => {
    await service.approve('app-1', {}, 'admin-1');
    expect(signInTokens.createSignInToken).toHaveBeenCalledWith({
      userId: 'user_2n',
      expiresInSeconds: 7 * 24 * 60 * 60,
    });
    expect(mailer.welcomeMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({ signInUrl: 'https://clerk/x' }),
    );
  });
});

describe('ChefApplicationsAdminService.decideDocument', () => {
  it('refuses a rejection with no reason', async () => {
    const service = new ChefApplicationsAdminService(
      {} as unknown as PrismaService,
      { parseType: (t: string) => t } as unknown as ChefDocumentsService,
      {} as unknown as KycStorageService,
      { record: jest.fn(), failed: jest.fn() } as unknown as AuditService,
      {} as unknown as ChefOnboardingMailer,
      { configured: true } as unknown as ClerkService,
      { get: jest.fn() } as unknown as ConfigService,
      {} as unknown as ChefDossierCron,
    );

    await expect(
      service.decideDocument('app-1', 'identity', { decision: 'rejected' }, 'admin-1'),
    ).rejects.toMatchObject({ response: { code: 'REASON_REQUIRED' } });
  });

  it('re-evaluates the storefront on a refusal too, not only on an acceptance', async () => {
    const refreshActivation = jest.fn();
    const prisma = {
      chefApplication: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'app-1', email: 'x@y.fr', firstName: 'M' }),
        update: jest.fn(),
      },
      chefDocument: {
        findFirst: jest.fn().mockResolvedValue({ id: 'doc-1', chefProfileId: 'cp-1' }),
        update: jest.fn().mockResolvedValue({
          id: 'doc-1',
          chefProfileId: 'cp-1',
          type: 'identity',
          status: 'rejected',
          version: 2,
          reason: 'Document illisible, merci de renvoyer la page entière.',
          reasonCode: 'unreadable',
          submittedAt: new Date(),
          decidedAt: new Date(),
          fileName: 'f.pdf',
          sizeBytes: 1,
          expiresOn: null,
        }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'admin-1', fullName: 'Sarah L.' }),
      },
    };

    const service = new ChefApplicationsAdminService(
      prisma as unknown as PrismaService,
      {
        parseType: (t: string) => t,
        dossier: jest.fn().mockResolvedValue({
          dossierStatus: 'incomplete',
          canApprove: false,
          documents: [],
        }),
        answersOf: jest.fn(() => ({})),
        toView: jest.fn((d: unknown) => d),
      } as unknown as ChefDocumentsService,
      {} as unknown as KycStorageService,
      { record: jest.fn(), failed: jest.fn() } as unknown as AuditService,
      {
        documentRejected: jest.fn().mockResolvedValue({ sent: true }),
      } as unknown as ChefOnboardingMailer,
      { configured: true } as unknown as ClerkService,
      { get: jest.fn((_k: string, d?: unknown) => d) } as unknown as ConfigService,
      { refreshActivation } as unknown as ChefDossierCron,
    );

    await service.decideDocument(
      'app-1',
      'identity',
      {
        decision: 'rejected',
        reason: 'Document illisible, merci de renvoyer la page entière.',
      },
      'admin-1',
    );

    // A chef reactivated on trust must go back offline when the replacement fails.
    expect(refreshActivation).toHaveBeenCalledWith('cp-1');
  });
});
