import { ConflictException, UnprocessableEntityException } from '@nestjs/common';

import { ChefDocumentStatus, ChefDocumentType } from '../../../generated/prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ChefDocumentsService } from './chef-documents.service';
import { KycStorageService } from './kyc-storage.service';

/** Documents belong to the chef profile from the first upload, candidate or not. */
const OWNER = 'chef-1';
const ANSWERS = {
  workAuthorizationStatus: 'eu_citizen' as const,
  companyLegalForm: 'micro' as const,
  sapPath: 'type_b' as const,
};

describe('ChefDocumentsService', () => {
  let service: ChefDocumentsService;
  let prisma: {
    chefDocument: { findMany: jest.Mock; findFirst: jest.Mock; create: jest.Mock };
    chefApplication: { updateMany: jest.Mock };
  };
  let storage: {
    putObject: jest.Mock;
    statObject: jest.Mock;
    buildPath: jest.Mock;
    createUploadUrl: jest.Mock;
    createDownloadUrl: jest.Mock;
  };
  let audit: { record: jest.Mock; failed: jest.Mock };

  beforeEach(() => {
    prisma = {
      chefDocument: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'doc-1',
          submittedAt: new Date(),
          decidedAt: null,
          reason: null,
          reasonCode: null,
          ...data,
        })),
      },
      chefApplication: { updateMany: jest.fn() },
    };
    storage = {
      putObject: jest.fn(),
      statObject: jest
        .fn()
        .mockResolvedValue({ sizeBytes: 842133, mimeType: 'application/pdf' }),
      buildPath: jest.fn(
        (prefix: string, type: string, id: string) => `${prefix}/${type}/${id}`,
      ),
      createUploadUrl: jest.fn(),
      createDownloadUrl: jest.fn().mockResolvedValue({
        url: 'https://storage.example/signed',
        expiresAt: new Date('2026-10-03T10:05:00.000Z'),
      }),
    };
    audit = { record: jest.fn(), failed: jest.fn() };

    service = new ChefDocumentsService(
      prisma as unknown as PrismaService,
      storage as unknown as KycStorageService,
      audit as unknown as AuditService,
    );
  });

  describe('readLink', () => {
    it('signs the latest deposit and journals who read it', async () => {
      prisma.chefDocument.findFirst.mockResolvedValue({
        id: 'doc-2',
        type: ChefDocumentType.identity,
        version: 2,
        storagePath: 'chefs/chef-1/identity/up_2',
        mimeType: 'application/pdf',
        fileName: 'cni-recto-verso.pdf',
      });
      const reader = { actorType: 'candidate' as const, actorUserId: 'u-1' };
      const link = await service.readLink(OWNER, 'identity', reader, 'req-1');

      // Only this profile's deposits, and the path is the stored one, never the client's.
      expect(prisma.chefDocument.findFirst).toHaveBeenCalledWith({
        where: { chefProfileId: OWNER, type: ChefDocumentType.identity },
        orderBy: { version: 'desc' },
      });
      expect(storage.createDownloadUrl).toHaveBeenCalledWith(
        'chefs/chef-1/identity/up_2',
      );
      expect(audit.record).toHaveBeenCalledWith({
        actorType: 'candidate',
        actorUserId: 'u-1',
        action: 'document.read',
        subjectType: 'chef_document',
        subjectId: 'doc-2',
        requestId: 'req-1',
        metadata: { type: 'identity', version: 2 },
      });
      expect(link).toEqual({
        url: 'https://storage.example/signed',
        expiresAt: new Date('2026-10-03T10:05:00.000Z'),
        type: 'identity',
        version: 2,
        mimeType: 'application/pdf',
        fileName: 'cni-recto-verso.pdf',
      });
    });

    it('answers 404 and signs nothing when no deposit exists for the type', async () => {
      await expect(
        service.readLink(OWNER, 'identity', { actorType: 'chef', actorUserId: 'u-1' }),
      ).rejects.toMatchObject({ status: 404 });
      expect(storage.createDownloadUrl).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('confirmUpload', () => {
    const confirm = (body: Record<string, unknown>, type = 'identity') =>
      service.confirmUpload(OWNER, type, body as never);

    it('records the deposit only after the object is confirmed present in the bucket', async () => {
      await confirm({ uploadId: 'up_1', expiresOn: '2099-03-14' });
      expect(storage.statObject).toHaveBeenCalledWith('chefs/chef-1/identity/up_1');
      expect(prisma.chefDocument.create).toHaveBeenCalled();
    });

    it('refuses a confirm for a file that was never uploaded', async () => {
      storage.statObject.mockRejectedValue(
        new ConflictException({ code: 'UPLOAD_NOT_CONFIRMED', message: 'missing' }),
      );
      await expect(
        confirm({ uploadId: 'up_1', expiresOn: '2099-03-14' }),
      ).rejects.toMatchObject({
        response: { code: 'UPLOAD_NOT_CONFIRMED' },
      });
      expect(prisma.chefDocument.create).not.toHaveBeenCalled();
    });

    it('trusts the bucket for size, not the client', async () => {
      await confirm({ uploadId: 'up_1', expiresOn: '2099-03-14' });
      expect(prisma.chefDocument.create.mock.calls[0][0].data.sizeBytes).toBe(842133);
    });

    it('starts at version 1', async () => {
      await confirm({ uploadId: 'up_1', expiresOn: '2099-03-14' });
      expect(prisma.chefDocument.create.mock.calls[0][0].data.version).toBe(1);
    });

    it('versions a re-deposit instead of overwriting it', async () => {
      prisma.chefDocument.findFirst.mockResolvedValue({ version: 2 });
      const result = await confirm({ uploadId: 'up_9', expiresOn: '2099-03-14' });
      expect(result.version).toBe(3);
      // Append-only: the previous row is never updated or deleted.
      expect(prisma.chefDocument.create).toHaveBeenCalledTimes(1);
    });

    it('lands back in `submitted`, so a corrected document is reviewed again', async () => {
      const result = await confirm({ uploadId: 'up_1', expiresOn: '2099-03-14' });
      expect(result.status).toBe(ChefDocumentStatus.submitted);
    });

    it('files the deposit under the chef profile, not a candidature', async () => {
      await confirm({ uploadId: 'up_1', expiresOn: '2099-03-14' });
      const { data } = prisma.chefDocument.create.mock.calls[0][0];
      expect(data.chefProfileId).toBe('chef-1');
      expect(data).not.toHaveProperty('applicationId');
    });

    it('touches lastActivityAt, which is what the abandonment purge reads', async () => {
      await confirm({ uploadId: 'up_1', expiresOn: '2099-03-14' });
      expect(prisma.chefApplication.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { chefProfileId: 'chef-1' } }),
      );
    });

    it.each(['identity', 'rc-pro', 'haccp', 'sap-declaration'])(
      'requires expiresOn for %s, which lapses',
      async (type) => {
        await expect(confirm({ uploadId: 'up_1' }, type)).rejects.toBeInstanceOf(
          UnprocessableEntityException,
        );
      },
    );

    it('does not require expiresOn for a registration certificate, which does not lapse', async () => {
      await expect(confirm({ uploadId: 'up_1' }, 'registration')).resolves.toBeDefined();
    });

    it('refuses an expiry date already in the past', async () => {
      await expect(
        confirm({ uploadId: 'up_1', expiresOn: '2020-01-01' }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('refuses an unknown document type', async () => {
      await expect(confirm({ uploadId: 'up_1' }, 'passport-photo')).rejects.toThrow();
    });

    it('never takes a SEPA mandate from the chef: only Stripe’s signature makes one', async () => {
      await expect(confirm({ uploadId: 'up_1' }, 'sepa-mandate')).rejects.toMatchObject({
        response: { code: 'SYSTEM_DOCUMENT' },
      });
      await expect(
        service.createUploadUrl(OWNER, 'sepa-mandate', {
          mimeType: 'application/pdf',
          sizeBytes: 1000,
        } as never),
      ).rejects.toMatchObject({ response: { code: 'SYSTEM_DOCUMENT' } });
      expect(prisma.chefDocument.create).not.toHaveBeenCalled();
    });
  });

  describe('recordSystemDocument', () => {
    const PDF = {
      bytes: Buffer.from('%PDF-1.4'),
      fileName: 'm.pdf',
      mimeType: 'application/pdf',
    };

    it('stores the file and files it already valid, as the next version of its type', async () => {
      prisma.chefDocument.findFirst.mockResolvedValue({ version: 1 });

      await service.recordSystemDocument(OWNER, ChefDocumentType.sepa_mandate, PDF, {
        stripeMandateId: 'mandate_1',
      });

      const [path, bytes, mimeType] = storage.putObject.mock.calls[0] as [
        string,
        Buffer,
        string,
      ];
      expect(path).toMatch(/^chefs\/chef-1\/sepa_mandate\/sys_[a-f0-9]{24}$/);
      expect(bytes).toBe(PDF.bytes);
      expect(mimeType).toBe('application/pdf');
      expect(prisma.chefDocument.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: ChefDocumentType.sepa_mandate,
          status: ChefDocumentStatus.valid,
          version: 2,
          storagePath: path,
          sizeBytes: PDF.bytes.length,
        }),
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: 'system',
          action: 'document.generated',
          metadata: expect.objectContaining({
            type: 'sepa-mandate',
            stripeMandateId: 'mandate_1',
          }),
        }),
      );
    });

    it('refuses to forge a chef deposit', async () => {
      await expect(
        service.recordSystemDocument(OWNER, ChefDocumentType.identity, PDF),
      ).rejects.toThrow();
      expect(storage.putObject).not.toHaveBeenCalled();
    });
  });

  describe('latestPerType', () => {
    it('keeps the highest version per type and ignores the history behind it', async () => {
      prisma.chefDocument.findMany.mockResolvedValue([
        { type: ChefDocumentType.identity, version: 3, status: ChefDocumentStatus.valid },
        {
          type: ChefDocumentType.identity,
          version: 2,
          status: ChefDocumentStatus.rejected,
        },
        {
          type: ChefDocumentType.identity,
          version: 1,
          status: ChefDocumentStatus.rejected,
        },
      ]);
      const latest = await service.latestPerType(OWNER);
      expect(latest.size).toBe(1);
      expect(latest.get(ChefDocumentType.identity)).toMatchObject({ version: 3 });
    });
  });

  describe('dossier', () => {
    it('reports a required document with no deposit as missing, without a placeholder row', async () => {
      const result = await service.dossier(OWNER, ANSWERS);
      const identity = result.documents.find((d) => d.type === 'identity');
      expect(identity).toMatchObject({ status: 'missing', version: 0, required: true });
      expect(result.dossierStatus).toBe('draft');
    });

    it('blocks approval until every blocking document is valid', async () => {
      prisma.chefDocument.findMany.mockResolvedValue([
        { type: ChefDocumentType.identity, version: 1, status: ChefDocumentStatus.valid },
      ]);
      const result = await service.dossier(OWNER, ANSWERS);
      // registration is still missing for a micro-entrepreneur.
      expect(result.dossierStatus).toBe('incomplete');
      expect(result.canApprove).toBe(false);
    });

    it('allows approval once identity and registration are both valid', async () => {
      prisma.chefDocument.findMany.mockResolvedValue([
        { type: ChefDocumentType.identity, version: 1, status: ChefDocumentStatus.valid },
        {
          type: ChefDocumentType.registration,
          version: 1,
          status: ChefDocumentStatus.valid,
        },
      ]);
      const result = await service.dossier(OWNER, ANSWERS);
      expect(result.dossierStatus).toBe('validated');
      expect(result.canApprove).toBe(true);
    });

    it('still lists a document that is no longer required but was deposited', async () => {
      prisma.chefDocument.findMany.mockResolvedValue([
        {
          type: ChefDocumentType.vigilance,
          version: 1,
          status: ChefDocumentStatus.valid,
          fileName: 'v.pdf',
          sizeBytes: 1,
          submittedAt: new Date(),
          expiresOn: null,
          reason: null,
          reasonCode: null,
        },
      ]);
      const result = await service.dossier(OWNER, ANSWERS);
      const vigilance = result.documents.find((d) => d.type === 'vigilance');
      expect(vigilance).toMatchObject({
        required: false,
        status: ChefDocumentStatus.valid,
      });
    });
  });
});
