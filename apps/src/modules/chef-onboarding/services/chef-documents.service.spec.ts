import { ConflictException, UnprocessableEntityException } from '@nestjs/common';

import { ChefDocumentStatus, ChefDocumentType } from '../../../generated/prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ChefDocumentsService } from './chef-documents.service';
import { KycStorageService } from './kyc-storage.service';

const OWNER = { kind: 'application' as const, applicationId: 'app-1' };
const ANSWERS = {
  workAuthorizationStatus: 'eu_citizen' as const,
  companyLegalForm: 'micro' as const,
  sapPath: 'type_b' as const,
};

describe('ChefDocumentsService', () => {
  let service: ChefDocumentsService;
  let prisma: {
    chefDocument: { findMany: jest.Mock; findFirst: jest.Mock; create: jest.Mock };
    chefApplication: { update: jest.Mock };
  };
  let storage: {
    statObject: jest.Mock;
    buildPath: jest.Mock;
    createUploadUrl: jest.Mock;
  };

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
      chefApplication: { update: jest.fn() },
    };
    storage = {
      statObject: jest
        .fn()
        .mockResolvedValue({ sizeBytes: 842133, mimeType: 'application/pdf' }),
      buildPath: jest.fn(
        (prefix: string, type: string, id: string) => `${prefix}/${type}/${id}`,
      ),
      createUploadUrl: jest.fn(),
    };

    service = new ChefDocumentsService(
      prisma as unknown as PrismaService,
      storage as unknown as KycStorageService,
      { record: jest.fn(), failed: jest.fn() } as unknown as AuditService,
    );
  });

  describe('confirmUpload', () => {
    const confirm = (body: Record<string, unknown>, type = 'identity') =>
      service.confirmUpload(OWNER, type, body as never);

    it('records the deposit only after the object is confirmed present in the bucket', async () => {
      await confirm({ uploadId: 'up_1', expiresOn: '2099-03-14' });
      expect(storage.statObject).toHaveBeenCalledWith('applications/app-1/identity/up_1');
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

    it('touches lastActivityAt, which is what the abandonment purge reads', async () => {
      await confirm({ uploadId: 'up_1', expiresOn: '2099-03-14' });
      expect(prisma.chefApplication.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'app-1' } }),
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
