import type { ConfigService } from '@nestjs/config';
import { UnprocessableEntityException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import type { AuditService } from '../../common/audit/audit.service';
import { seal } from '../../common/crypto/field-cipher';
import type { GeoService } from '../../integrations/geo.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { KycStorageService } from '../chef-onboarding/services/kyc-storage.service';
import type { UsersService } from '../users/users.service';
import type { UrssafDossier } from './domain/urssaf-dossier.rules';
import { UrssafDossiersService } from './urssaf-dossiers.service';

const KEY = randomBytes(32);
const IBAN = 'FR7630006000011234567890189';

const DOSSIER: UrssafDossier = {
  civility: 'F',
  birthName: 'Marchand',
  usageName: null,
  firstNames: 'Sophie',
  birthDate: '1981-04-12',
  birthCountryCode: '99100',
  birthDepartmentCode: '075',
  birthCommuneCode: '75056',
  birthCommuneName: 'Paris',
  mobilePhone: '0612345678',
  email: 'sophie@exemple.fr',
  address: {
    line1: '12 rue des Lilas',
    line2: null,
    postalCode: '75011',
    city: 'Paris',
    countryCode: '99100',
  },
  iban: IBAN,
  bic: 'AGRIFRPP',
  accountHolder: 'Sophie Marchand',
};

function setup(opts: { key?: string; existing?: { storagePath: string } | null } = {}) {
  const stored = new Map<string, Buffer>();
  const row = (storagePath: string) => ({
    id: 'd1',
    userId: 'u1',
    storagePath,
    ibanLast4: '0189',
    filledAt: new Date('2026-11-16T10:00:00Z'),
    updatedAt: new Date('2026-11-16T10:00:00Z'),
  });
  const existing = opts.existing === undefined ? null : opts.existing;
  if (existing) {
    stored.set(existing.storagePath, Buffer.from(seal(JSON.stringify(DOSSIER), KEY)));
  }
  const prisma = {
    urssafClientDossier: {
      findUnique: jest
        .fn()
        .mockResolvedValue(existing ? row(existing.storagePath) : null),
      upsert: jest.fn(({ create }: { create: { storagePath: string } }) =>
        Promise.resolve(row(create.storagePath)),
      ),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(existing ? 1 : 0),
    },
    urssafLink: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'l1',
        clientId: 'u1',
        chefProfileId: 'c1',
        chefProfile: { sapProfile: { novaCode: 'SAP123456789' } },
      }),
    },
  };
  const storage = {
    putObject: jest.fn((path: string, body: Buffer) => {
      stored.set(path, body);
      return Promise.resolve();
    }),
    getObject: jest.fn((path: string) => Promise.resolve(stored.get(path)!)),
    removeObjects: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { record: jest.fn() };
  const users = { ensurePersistedFromClerk: jest.fn().mockResolvedValue({ id: 'u1' }) };
  const config = {
    get: () => ('key' in opts ? opts.key : KEY.toString('base64')),
  };
  const geo = { assertCommune: jest.fn().mockResolvedValue(undefined) };
  const service = new UrssafDossiersService(
    prisma as unknown as PrismaService,
    users as unknown as UsersService,
    storage as unknown as KycStorageService,
    config as unknown as ConfigService,
    audit as unknown as AuditService,
    geo as unknown as GeoService,
  );
  return { service, prisma, storage, audit, geo };
}

describe('UrssafDossiersService', () => {
  it('seals the dossier before it reaches the bucket', async () => {
    const { service, storage, prisma } = setup();
    await service.save('clerk', DOSSIER);

    const [path, body] = storage.putObject.mock.calls[0] as [string, Buffer];
    expect(path).toMatch(/^clients\/u1\/urssaf-dossier-[0-9a-f]+\.enc$/);
    expect(body.toString()).toMatch(/^v1:/);
    expect(body.toString()).not.toContain(IBAN);
    expect(body.toString()).not.toContain('Marchand');
    expect(prisma.urssafClientDossier.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { userId: 'u1', storagePath: path, ibanLast4: '0189' },
      }),
    );
  });

  it('refuses a town the postcode does not serve, storing nothing', async () => {
    const { service, storage, geo } = setup();
    geo.assertCommune.mockRejectedValue(
      new UnprocessableEntityException({ code: 'ADDRESS_CITY_MISMATCH' }),
    );

    await expect(
      service.save('clerk', {
        ...DOSSIER,
        address: { ...DOSSIER.address, postalCode: '77127', city: 'Marseille' },
      }),
    ).rejects.toMatchObject({ response: { code: 'ADDRESS_CITY_MISMATCH' } });
    expect(geo.assertCommune).toHaveBeenCalledWith('77127', 'Marseille', 'address.city');
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('replaces the previous object on a new save', async () => {
    const { service, storage } = setup({
      existing: { storagePath: 'clients/u1/old.enc' },
    });
    await service.save('clerk', DOSSIER);
    expect(storage.removeObjects).toHaveBeenCalledWith(['clients/u1/old.enc']);
  });

  it('refuses an invalid dossier with every problem, storing nothing', async () => {
    const { service, storage } = setup();
    await expect(
      service.save('clerk', { ...DOSSIER, iban: 'FR7630006000011234567890188' }),
    ).rejects.toMatchObject({
      response: {
        code: 'URSSAF_DOSSIER_INVALID',
        errors: [expect.objectContaining({ field: 'iban', code: 'INVALID_IBAN' })],
      },
    });
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('shows the owner their dossier without the IBAN', async () => {
    const { service } = setup({ existing: { storagePath: 'clients/u1/a.enc' } });
    const view = await service.mine('clerk');
    expect(view.filled).toBe(true);
    expect(view.ibanLast4).toBe('0189');
    expect(JSON.stringify(view)).not.toContain(IBAN);
    expect(view.dossier?.birthName).toBe('Marchand');
  });

  it('says so when there is no dossier', async () => {
    const { service } = setup();
    await expect(service.mine('clerk')).resolves.toEqual(
      expect.objectContaining({ filled: false, dossier: null }),
    );
  });

  it('reveals the whole dossier to an admin, audited', async () => {
    const { service, audit } = setup({ existing: { storagePath: 'clients/u1/a.enc' } });
    const revealed = await service.reveal('admin-clerk', 'l1');
    expect(revealed.dossier.iban).toBe(IBAN);
    expect(revealed.chefNovaCode).toBe('SAP123456789');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'urssaf.dossier_revealed',
        subjectType: 'urssaf_link',
        subjectId: 'l1',
      }),
    );
  });

  it('answers 404 URSSAF_DOSSIER_MISSING when the client has none', async () => {
    const { service } = setup();
    await expect(service.reveal('admin-clerk', 'l1')).rejects.toMatchObject({
      response: { code: 'URSSAF_DOSSIER_MISSING' },
    });
  });

  it('removes the row and the object', async () => {
    const { service, storage, prisma } = setup({
      existing: { storagePath: 'clients/u1/a.enc' },
    });
    await service.remove('clerk');
    expect(prisma.urssafClientDossier.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
    });
    expect(storage.removeObjects).toHaveBeenCalledWith(['clients/u1/a.enc']);
  });

  it('answers 503 KYC_STORAGE_UNAVAILABLE without a key', async () => {
    const { service } = setup({ key: undefined });
    await expect(service.save('clerk', DOSSIER)).rejects.toMatchObject({
      response: { code: 'KYC_STORAGE_UNAVAILABLE' },
    });
  });
});
