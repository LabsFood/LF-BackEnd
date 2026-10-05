import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { R2StorageService } from '../../integrations/r2-storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ChefPhotoService } from './chef-photo.service';

const BASE = 'https://photos.labsfood.fr';
const UPLOAD_ID = 'ph_0123456789abcdef01234567';
const KEY = `chefs/cp-1/avatar/${UPLOAD_ID}.jpg`;

function setup(avatarUrl: string | null = null) {
  const real = new R2StorageService({ get: () => ({}) } as never);
  const prisma = {
    chefProfile: {
      findFirst: jest.fn().mockResolvedValue({ id: 'cp-1', avatarUrl }),
      findUnique: jest.fn().mockResolvedValue({ id: 'cp-1', avatarUrl }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'cp-1',
        ...data,
      })),
    },
  };
  const storage = {
    assertAcceptable: jest.fn((type: string, size: number) =>
      real.assertAcceptable(type, size),
    ),
    createUploadUrl: jest.fn(async () => ({
      method: 'PUT',
      url: 'https://signed.example/put',
      headers: { 'Content-Type': 'image/jpeg' },
      expiresAt: new Date(),
    })),
    assertUploaded: jest.fn(async () => undefined),
    publicUrl: jest.fn((key: string) => `${BASE}/${key}`),
    keyOf: jest.fn((url: string | null) =>
      url?.startsWith(`${BASE}/`) ? url.slice(BASE.length + 1) : null,
    ),
    delete: jest.fn(async () => undefined),
  };
  const audit = { record: jest.fn() };
  const service = new ChefPhotoService(
    prisma as unknown as PrismaService,
    storage as unknown as R2StorageService,
    audit as unknown as AuditService,
  );
  return { prisma, storage, audit, service };
}

describe('ChefPhotoService', () => {
  it('signs an upload under the caller’s own profile, candidate or approved', async () => {
    const { prisma, storage, service } = setup();

    const result = await service.uploadUrl('clerk_1', {
      contentType: 'image/jpeg',
      sizeBytes: 480_000,
    });

    // The caller's own profile, whatever its verification: a candidate may set it.
    expect(prisma.chefProfile.findFirst).toHaveBeenCalledWith({
      where: { user: { clerkUserId: 'clerk_1' } },
      select: { id: true, avatarUrl: true },
    });
    const [[key]] = storage.createUploadUrl.mock.calls as unknown as [[string]];
    expect(key).toMatch(/^chefs\/cp-1\/avatar\/ph_[a-f0-9]{24}\.jpg$/);
    expect(result.uploadId).toMatch(/^ph_[a-f0-9]{24}$/);
  });

  it('refuses a file that is not a picture, or too large', async () => {
    const { service } = setup();
    for (const [contentType, sizeBytes] of [
      ['application/pdf', 1000],
      ['image/png', 6 * 1024 * 1024],
    ] as const) {
      await expect(
        service.uploadUrl('clerk_1', { contentType, sizeBytes }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    }
  });

  it('checks the file, makes it the photo and deletes the previous one', async () => {
    const { prisma, storage, service } = setup(`${BASE}/chefs/cp-1/avatar/old.jpg`);

    await service.confirm('clerk_1', { uploadId: UPLOAD_ID, contentType: 'image/jpeg' });

    expect(storage.assertUploaded).toHaveBeenCalledWith(KEY, 'image/jpeg');
    expect(prisma.chefProfile.update).toHaveBeenCalledWith({
      where: { id: 'cp-1' },
      data: { avatarUrl: `${BASE}/${KEY}` },
    });
    expect(storage.delete).toHaveBeenCalledWith('chefs/cp-1/avatar/old.jpg');
  });

  it('changes nothing when the storage check refuses the file', async () => {
    const { prisma, storage, service } = setup();
    storage.assertUploaded.mockRejectedValue(
      new ConflictException({ code: 'UPLOAD_NOT_CONFIRMED' }),
    );

    await expect(
      service.confirm('clerk_1', { uploadId: UPLOAD_ID, contentType: 'image/jpeg' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.chefProfile.update).not.toHaveBeenCalled();
  });

  it('never deletes a file outside this profile’s photo folder', async () => {
    // The same chef's dish photo, and another chef's profile photo.
    for (const url of [
      `${BASE}/chefs/cp-1/dishes/d1/ph_x.jpg`,
      `${BASE}/chefs/cp-2/avatar/ph_x.jpg`,
    ]) {
      const { storage, service } = setup(url);
      await service.removeOwn('clerk_1');
      expect(storage.delete).not.toHaveBeenCalled();
    }
  });

  it('removes the photo from the page and from storage', async () => {
    const { prisma, storage, service } = setup(`${BASE}/${KEY}`);

    await service.removeOwn('clerk_1');

    expect(prisma.chefProfile.update).toHaveBeenCalledWith({
      where: { id: 'cp-1' },
      data: { avatarUrl: null },
    });
    expect(storage.delete).toHaveBeenCalledWith(KEY);
  });

  it('lets an admin take a photo down, on the record', async () => {
    const { prisma, storage, audit, service } = setup(`${BASE}/${KEY}`);

    await service.takeDown('cp-1', 'admin-1');

    expect(prisma.chefProfile.update).toHaveBeenCalledWith({
      where: { id: 'cp-1' },
      data: { avatarUrl: null },
    });
    expect(storage.delete).toHaveBeenCalledWith(KEY);
    expect(audit.record).toHaveBeenCalledWith({
      actorType: 'admin',
      actorUserId: 'admin-1',
      action: 'chef.photo_removed',
      subjectType: 'chef_profile',
      subjectId: 'cp-1',
    });
  });

  it('answers 404 to an account with no batch cooker profile', async () => {
    const { prisma, service } = setup();
    prisma.chefProfile.findFirst.mockResolvedValue(null);

    await expect(
      service.uploadUrl('clerk_9', { contentType: 'image/jpeg', sizeBytes: 1000 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
