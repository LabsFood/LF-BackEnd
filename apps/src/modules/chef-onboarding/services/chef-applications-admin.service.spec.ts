import { ChefApplicationStatus } from '../../../generated/prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
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
  interventionZones: [{ regionCode: '84' }],
  sapPath: 'type_a',
  sapDeclarationNumber: 'SAP443061841',
  workAuthorizationStatus: 'eu_citizen',
  companyLegalForm: 'micro',
  chefProfileId: 'cp-1',
  ...over,
});

const validatedDossier = { dossierStatus: 'validated', canApprove: true, documents: [] };

/** A Prisma stand-in whose interactive transaction runs against the same mocks. */
const makePrisma = () => {
  const prisma = {
    chefApplication: {
      findUnique: jest.fn().mockResolvedValue(application()),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        ...application({ status: ChefApplicationStatus.approved, decidedAt: new Date() }),
        chefProfile: {
          id: 'cp-1',
          displayName: 'Marie Dupont',
          isVerified: true,
          isActive: false,
          user: {
            id: 'u-1',
            clerkUserId: 'user_2n',
            email: 'marie.dupont@exemple.fr',
            role: 'chef',
          },
        },
      }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    chefProfile: { update: jest.fn() },
    chefDocument: { findFirst: jest.fn(), update: jest.fn() },
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn(prisma),
  );
  return prisma;
};

const makeService = (over: {
  prisma?: ReturnType<typeof makePrisma>;
  documents?: Record<string, unknown>;
  mailer?: Record<string, unknown>;
  audit?: Record<string, unknown>;
  dossier?: Record<string, unknown>;
}) =>
  new ChefApplicationsAdminService(
    (over.prisma ?? makePrisma()) as unknown as PrismaService,
    {
      parseType: (t: string) => t,
      dossier: jest.fn().mockResolvedValue(validatedDossier),
      answersOf: jest.fn(() => ({})),
      toView: jest.fn((d: unknown) => d),
      ...over.documents,
    } as unknown as ChefDocumentsService,
    {} as unknown as KycStorageService,
    (over.audit ?? { record: jest.fn(), failed: jest.fn() }) as unknown as AuditService,
    {
      applicationApproved: jest.fn().mockResolvedValue({ sent: true }),
      applicationRejected: jest.fn().mockResolvedValue({ sent: true }),
      documentRejected: jest.fn().mockResolvedValue({ sent: true }),
      changesRequested: jest.fn().mockResolvedValue({ sent: true }),
      ...over.mailer,
    } as unknown as ChefOnboardingMailer,
    (over.dossier ?? { refreshActivation: jest.fn() }) as unknown as ChefDossierCron,
  );

describe('ChefApplicationsAdminService.approve', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let documents: { dossier: jest.Mock };
  let mailer: { applicationApproved: jest.Mock };
  let audit: { record: jest.Mock; failed: jest.Mock };
  let service: ChefApplicationsAdminService;

  beforeEach(() => {
    prisma = makePrisma();
    documents = { dossier: jest.fn().mockResolvedValue(validatedDossier) };
    mailer = { applicationApproved: jest.fn().mockResolvedValue({ sent: true }) };
    audit = { record: jest.fn(), failed: jest.fn() };
    service = makeService({ prisma, documents, mailer, audit });
  });

  it('verifies the account that already exists, copying the answers onto the profile', async () => {
    const result = await service.approve('app-1', {}, 'admin-1');
    expect(prisma.chefProfile.update).toHaveBeenCalledWith({
      where: { id: 'cp-1' },
      data: expect.objectContaining({
        isVerified: true,
        // From the approved answers, which a reapplication may have changed.
        displayName: 'Marie Dupont',
        city: 'Lyon',
        interventionZones: [{ regionCode: '84' }],
        sapPath: 'type_a',
        sapDeclarationNumber: 'SAP443061841',
      }),
    });
    expect(result.chefProfile).toMatchObject({ id: 'cp-1', isVerified: true });
    expect(result.user).toMatchObject({ id: 'u-1' });
  });

  it('leaves the chef unpublished unless isActive is explicitly requested', async () => {
    await service.approve('app-1', {}, 'admin-1');
    expect(prisma.chefProfile.update.mock.calls[0][0].data.isActive).toBe(false);

    await service.approve('app-1', { isActive: true }, 'admin-1');
    expect(prisma.chefProfile.update.mock.calls[1][0].data.isActive).toBe(true);
  });

  it('moves the candidature to approved only from an undecided status, atomically', async () => {
    await service.approve('app-1', {}, 'admin-1');
    expect(prisma.chefApplication.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'app-1',
        status: {
          in: [ChefApplicationStatus.submitted, ChefApplicationStatus.changes_requested],
        },
      },
      data: expect.objectContaining({
        status: ChefApplicationStatus.approved,
        decidedByUserId: 'admin-1',
      }),
    });
  });

  it('verifies nobody when a concurrent decision got there first', async () => {
    prisma.chefApplication.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.approve('app-1', {}, 'admin-1')).rejects.toMatchObject({
      response: { code: 'APPLICATION_DECIDED' },
    });
    expect(prisma.chefProfile.update).not.toHaveBeenCalled();
  });

  it('tells the candidate they are approved', async () => {
    await service.approve('app-1', {}, 'admin-1');
    expect(mailer.applicationApproved).toHaveBeenCalledWith({
      email: 'marie.dupont@exemple.fr',
      firstName: 'Marie',
    });
  });

  it('refuses a candidature whose account was deleted — it is only a consent record now', async () => {
    prisma.chefApplication.findUnique.mockResolvedValue(
      application({ chefProfileId: null }),
    );
    await expect(service.approve('app-1', {}, 'admin-1')).rejects.toMatchObject({
      status: 404,
    });
  });

  describe('the guardrail: no verified chef without validated blocking documents', () => {
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

    it('verifies nothing when it refuses', async () => {
      await expect(service.approve('app-1', {}, 'admin-1')).rejects.toThrow();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.chefProfile.update).not.toHaveBeenCalled();
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
    it('returns the first result instead of approving twice', async () => {
      prisma.chefApplication.findUnique.mockResolvedValue(
        application({ status: ChefApplicationStatus.approved }),
      );
      const result = await service.approve('app-1', {}, 'admin-1');
      expect(prisma.$transaction).not.toHaveBeenCalled();
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
});

describe('ChefApplicationsAdminService.reject', () => {
  const body = {
    reason: "Zone d'intervention non couverte pour l'instant.",
    reasonCode: 'out-of-area',
    allowReapplyAfter: '2027-01-01',
  };

  it('records the reason and reapply date, and leaves the account alone', async () => {
    const prisma = makePrisma();
    const applicationRejected = jest.fn().mockResolvedValue({ sent: true });
    const service = makeService({ prisma, mailer: { applicationRejected } });

    const result = await service.reject('app-1', body, 'admin-1');

    expect(prisma.chefApplication.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'app-1' }),
      data: expect.objectContaining({
        status: ChefApplicationStatus.rejected,
        decisionReason: body.reason,
        allowReapplyAfter: new Date('2027-01-01'),
      }),
    });
    // The refused candidate keeps their account, browse-only.
    expect(prisma.chefProfile.update).not.toHaveBeenCalled();
    expect(applicationRejected).toHaveBeenCalledWith(
      expect.objectContaining({ reason: body.reason, allowReapplyAfter: '2027-01-01' }),
    );
    expect(result).toMatchObject({ status: 'rejected', allowReapplyAfter: '2027-01-01' });
  });

  it('keeps the full decision in the audit log — a reapplication clears it from the row', async () => {
    const audit = { record: jest.fn(), failed: jest.fn() };
    await makeService({ audit }).reject('app-1', body, 'admin-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'application.rejected',
        metadata: {
          reasonCode: 'out-of-area',
          reason: body.reason,
          allowReapplyAfter: '2027-01-01',
        },
      }),
    );
  });

  it('cannot overwrite an approval that landed first', async () => {
    const prisma = makePrisma();
    prisma.chefApplication.updateMany.mockResolvedValue({ count: 0 });
    const applicationRejected = jest.fn();
    const service = makeService({ prisma, mailer: { applicationRejected } });

    await expect(service.reject('app-1', body, 'admin-1')).rejects.toMatchObject({
      response: { code: 'APPLICATION_DECIDED' },
    });
    expect(applicationRejected).not.toHaveBeenCalled();
  });
});

describe('ChefApplicationsAdminService.requestChanges', () => {
  it('asks for more without a candidate token, pointing at the dossier instead', async () => {
    const prisma = makePrisma();
    const changesRequested = jest.fn().mockResolvedValue({ sent: true });
    const service = makeService({ prisma, mailer: { changesRequested } });

    await service.requestChanges(
      'app-1',
      { documentTypes: ['identity'], message: "Pièce d'identité illisible." },
      'admin-1',
    );

    expect(prisma.chefApplication.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: ChefApplicationStatus.changes_requested },
      }),
    );
    expect(changesRequested).toHaveBeenCalledWith({
      email: 'marie.dupont@exemple.fr',
      firstName: 'Marie',
      message: "Pièce d'identité illisible.",
      documentLabels: [expect.any(String)],
    });
  });
});

describe('ChefApplicationsAdminService.list', () => {
  it('leaves out candidatures whose account was deleted', async () => {
    const prisma = makePrisma();
    await makeService({ prisma }).list({ hasPendingDocuments: true } as never);
    const { where } = prisma.chefApplication.findMany.mock.calls[0][0];
    expect(where.chefProfileId).toEqual({ not: null });
    // Pending documents are the chef profile's: that is where every deposit lives.
    expect(where.chefProfile).toEqual({
      documents: { some: { status: { in: ['submitted', 'reviewing'] } } },
    });
  });
});

describe('ChefApplicationsAdminService.decideDocument', () => {
  it('refuses a rejection with no reason', async () => {
    const service = makeService({});
    await expect(
      service.decideDocument('app-1', 'identity', { decision: 'rejected' }, 'admin-1'),
    ).rejects.toMatchObject({ response: { code: 'REASON_REQUIRED' } });
  });

  it('decides the latest deposit on the chef profile, and re-evaluates the storefront on a refusal', async () => {
    const prisma = makePrisma();
    prisma.chefDocument.findFirst.mockResolvedValue({
      id: 'doc-1',
      chefProfileId: 'cp-1',
    });
    prisma.chefDocument.update.mockResolvedValue({
      id: 'doc-1',
      chefProfileId: 'cp-1',
      type: 'identity',
      status: 'rejected',
      version: 2,
      reason: 'Document illisible, merci de renvoyer la page entière.',
      reasonCode: 'unreadable',
    });
    prisma.user.findUnique.mockResolvedValue({ id: 'admin-1', fullName: 'Sarah L.' });
    const refreshActivation = jest.fn();
    const documentRejected = jest.fn().mockResolvedValue({ sent: true });
    const service = makeService({
      prisma,
      dossier: { refreshActivation },
      mailer: { documentRejected },
    });

    await service.decideDocument(
      'app-1',
      'identity',
      {
        decision: 'rejected',
        reason: 'Document illisible, merci de renvoyer la page entière.',
      },
      'admin-1',
    );

    expect(prisma.chefDocument.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { chefProfileId: 'cp-1', type: 'identity' } }),
    );
    // A chef reactivated on trust must go back offline when the replacement fails.
    expect(refreshActivation).toHaveBeenCalledWith('cp-1');
    expect(documentRejected).toHaveBeenCalledWith({
      email: 'marie.dupont@exemple.fr',
      firstName: 'Marie',
      documentLabel: expect.any(String),
      reason: 'Document illisible, merci de renvoyer la page entière.',
    });
  });
});
