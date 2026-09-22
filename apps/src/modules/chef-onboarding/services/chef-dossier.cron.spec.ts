import { ChefDocumentStatus, ChefDocumentType } from '../../../generated/prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ChefDocumentsService } from './chef-documents.service';
import { ChefDossierCron } from './chef-dossier.cron';
import { ChefOnboardingMailer } from './chef-onboarding.mailer';
import { KycStorageService } from './kyc-storage.service';

const DAY = 24 * 60 * 60 * 1000;
const inDays = (n: number) => new Date(Date.now() + n * DAY);

const chefProfile = (over: Record<string, unknown> = {}) => ({
  id: 'cp-1',
  isVerified: true,
  isActive: true,
  autoSuspendedAt: null,
  user: { email: 'marie@exemple.fr', fullName: 'Marie Dupont' },
  ...over,
});

describe('ChefDossierCron', () => {
  let cron: ChefDossierCron;
  let prisma: {
    chefDocument: { findMany: jest.Mock; update: jest.Mock; deleteMany: jest.Mock };
    chefProfile: { update: jest.Mock; findUnique: jest.Mock };
    chefApplication: { findMany: jest.Mock; deleteMany: jest.Mock };
  };
  let mailer: { documentExpiring: jest.Mock; chefSuspended: jest.Mock };
  let storage: { removeObjects: jest.Mock };
  let documents: {
    latestPerType: jest.Mock;
    deriveStatus: jest.Mock;
    answersOf: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      chefDocument: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      chefProfile: { update: jest.fn(), findUnique: jest.fn() },
      chefApplication: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
      },
    };
    mailer = {
      documentExpiring: jest.fn().mockResolvedValue({ sent: true }),
      chefSuspended: jest.fn().mockResolvedValue({ sent: true }),
    };
    storage = { removeObjects: jest.fn() };
    documents = {
      latestPerType: jest.fn().mockResolvedValue(new Map()),
      deriveStatus: jest.fn().mockReturnValue('validated'),
      answersOf: jest.fn(() => ({})),
    };

    cron = new ChefDossierCron(
      prisma as unknown as PrismaService,
      documents as unknown as ChefDocumentsService,
      storage as unknown as KycStorageService,
      mailer as unknown as ChefOnboardingMailer,
      { record: jest.fn(), failed: jest.fn() } as unknown as AuditService,
    );
  });

  describe('expiry warnings', () => {
    const expiringDoc = (daysLeft: number, noticeSent: number | null = null) => ({
      id: 'doc-1',
      type: ChefDocumentType.rc_pro,
      status: ChefDocumentStatus.valid,
      expiresOn: inDays(daysLeft),
      expiryNoticeDays: noticeSent,
      chefProfile: chefProfile(),
    });

    it.each([
      [59, 60],
      [29, 30],
      [6, 7],
    ])('at J-%i sends the %i-day notice', async (daysLeft, threshold) => {
      prisma.chefDocument.findMany.mockResolvedValueOnce([expiringDoc(daysLeft)]);
      await cron.runDaily();
      expect(mailer.documentExpiring).toHaveBeenCalledWith(
        expect.objectContaining({ daysLeft: threshold }),
      );
      expect(prisma.chefDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: ChefDocumentStatus.expiring, expiryNoticeDays: threshold },
        }),
      );
    });

    it('warns verified chefs only — a candidate’s piece lapsing mid-review is the review’s business', async () => {
      await cron.runDaily();
      expect(prisma.chefDocument.findMany.mock.calls[0][0].where.chefProfile).toEqual({
        isVerified: true,
      });
    });

    it('does not warn a document still more than 60 days out', async () => {
      prisma.chefDocument.findMany.mockResolvedValueOnce([expiringDoc(90)]);
      await cron.runDaily();
      expect(mailer.documentExpiring).not.toHaveBeenCalled();
    });

    it('never repeats a threshold it has already sent — the job is idempotent', async () => {
      prisma.chefDocument.findMany.mockResolvedValueOnce([expiringDoc(45, 60)]);
      await cron.runDaily();
      expect(mailer.documentExpiring).not.toHaveBeenCalled();
    });

    it('escalates to the next threshold once crossed', async () => {
      prisma.chefDocument.findMany.mockResolvedValueOnce([expiringDoc(20, 60)]);
      await cron.runDaily();
      expect(mailer.documentExpiring).toHaveBeenCalledWith(
        expect.objectContaining({ daysLeft: 30 }),
      );
    });
  });

  describe('expiry and automatic suspension', () => {
    const lapsed = (type: ChefDocumentType, profile = chefProfile()) => ({
      id: 'doc-x',
      type,
      status: ChefDocumentStatus.valid,
      expiresOn: inDays(-1),
      chefProfile: profile,
    });

    it('takes the storefront offline when a blocking document lapses', async () => {
      prisma.chefDocument.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([lapsed(ChefDocumentType.identity)]);
      await cron.runDaily();

      expect(prisma.chefProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { isActive: false, autoSuspendedAt: expect.any(Date) },
        }),
      );
      expect(mailer.chefSuspended).toHaveBeenCalled();
    });

    it('leaves the storefront up when a merely recommended document lapses', async () => {
      prisma.chefDocument.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([lapsed(ChefDocumentType.rc_pro)]);
      await cron.runDaily();

      expect(prisma.chefProfile.update).not.toHaveBeenCalled();
      expect(mailer.chefSuspended).not.toHaveBeenCalled();
    });

    it('does not re-suspend a chef who is already offline', async () => {
      prisma.chefDocument.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          lapsed(ChefDocumentType.identity, chefProfile({ isActive: false })),
        ]);
      await cron.runDaily();
      expect(prisma.chefProfile.update).not.toHaveBeenCalled();
    });
  });

  describe('refreshActivation — the suspension episode (FLOW-01 §7)', () => {
    const suspended = (over: Record<string, unknown> = {}) =>
      chefProfile({
        isActive: false,
        autoSuspendedAt: new Date(),
        application: {},
        ...over,
      });

    it('brings the storefront back the moment a replacement is deposited', async () => {
      // Freshly deposited means `reviewing`, not `valid` — that is the point.
      prisma.chefProfile.findUnique.mockResolvedValue(suspended());
      documents.deriveStatus.mockReturnValue('reviewing');

      await expect(cron.refreshActivation('cp-1')).resolves.toBe(true);
      expect(prisma.chefProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isActive: true } }),
      );
    });

    it('keeps the episode open while the replacement is unreviewed', async () => {
      prisma.chefProfile.findUnique.mockResolvedValue(suspended());
      documents.deriveStatus.mockReturnValue('reviewing');
      await cron.refreshActivation('cp-1');

      // autoSuspendedAt is NOT cleared — that is what flags the admin queue.
      const data = prisma.chefProfile.update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('autoSuspendedAt');
    });

    it('closes the episode once an admin validates the replacement', async () => {
      prisma.chefProfile.findUnique.mockResolvedValue(suspended({ isActive: true }));
      documents.deriveStatus.mockReturnValue('validated');

      await expect(cron.refreshActivation('cp-1')).resolves.toBe(true);
      expect(prisma.chefProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isActive: true, autoSuspendedAt: null } }),
      );
    });

    it('takes a reactivated chef back offline when the replacement is refused', async () => {
      // Refusing the blocking document drops the dossier to `incomplete`.
      prisma.chefProfile.findUnique.mockResolvedValue(suspended({ isActive: true }));
      documents.deriveStatus.mockReturnValue('incomplete');

      await expect(cron.refreshActivation('cp-1')).resolves.toBe(false);
      expect(prisma.chefProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isActive: false } }),
      );
    });

    it('does not write when an offline chef is still not acceptable', async () => {
      prisma.chefProfile.findUnique.mockResolvedValue(suspended());
      documents.deriveStatus.mockReturnValue('incomplete');

      await expect(cron.refreshActivation('cp-1')).resolves.toBe(false);
      expect(prisma.chefProfile.update).not.toHaveBeenCalled();
    });

    it('is idempotent — re-running on an already-live chef writes nothing', async () => {
      prisma.chefProfile.findUnique.mockResolvedValue(suspended({ isActive: true }));
      documents.deriveStatus.mockReturnValue('reviewing');

      await expect(cron.refreshActivation('cp-1')).resolves.toBe(true);
      expect(prisma.chefProfile.update).not.toHaveBeenCalled();
    });

    it('never reactivates a chef an admin deliberately deactivated', async () => {
      // autoSuspendedAt null = a human decision, not this job's.
      prisma.chefProfile.findUnique.mockResolvedValue(
        chefProfile({ isActive: false, autoSuspendedAt: null, application: {} }),
      );
      documents.deriveStatus.mockReturnValue('validated');

      await expect(cron.refreshActivation('cp-1')).resolves.toBe(false);
      expect(prisma.chefProfile.update).not.toHaveBeenCalled();
    });

    it('never brings an unverified profile online, whatever its documents say', async () => {
      prisma.chefProfile.findUnique.mockResolvedValue(suspended({ isVerified: false }));
      documents.deriveStatus.mockReturnValue('validated');

      await expect(cron.refreshActivation('cp-1')).resolves.toBe(false);
      expect(prisma.chefProfile.update).not.toHaveBeenCalled();
    });

    it('does nothing for a chef with no linked candidature', async () => {
      prisma.chefProfile.findUnique.mockResolvedValue(
        chefProfile({ autoSuspendedAt: new Date(), application: null }),
      );
      await expect(cron.refreshActivation('cp-1')).resolves.toBe(false);
    });
  });

  describe('retention purge', () => {
    it('deletes the files and rows of an abandoned candidature, keeping the account and the consent proof', async () => {
      prisma.chefApplication.findMany.mockResolvedValue([
        {
          id: 'app-old',
          status: 'submitted',
          chefProfile: {
            documents: [{ id: 'd1', storagePath: 'chefs/cp-1/identity/up_1' }],
          },
        },
      ]);
      await cron.runDaily();

      expect(storage.removeObjects).toHaveBeenCalledWith(['chefs/cp-1/identity/up_1']);
      expect(prisma.chefDocument.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['d1'] } },
      });
      // The candidature row survives: §8 keeps the consent proof for 5 years. So
      // does the account: a refused candidate keeps it, browse-only.
      expect(prisma.chefApplication.deleteMany).not.toHaveBeenCalled();
      expect(prisma.chefProfile.update).not.toHaveBeenCalled();
    });

    it('only ever looks at unverified profiles — a verified chef’s documents are their live dossier', async () => {
      await cron.runDaily();
      expect(prisma.chefApplication.findMany.mock.calls[0][0].where.chefProfile).toEqual({
        isVerified: false,
        documents: { some: {} },
      });
    });
  });

  it('survives a failure without throwing, so one bad row cannot stop the job', async () => {
    prisma.chefDocument.findMany.mockRejectedValue(new Error('db down'));
    await expect(cron.runDaily()).resolves.toBeUndefined();
  });
});
