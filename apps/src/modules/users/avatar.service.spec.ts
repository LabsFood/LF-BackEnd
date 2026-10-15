import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { R2StorageService } from '../../integrations/r2-storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AvatarService } from './avatar.service';

const BASE = 'https://photos.labsfood.fr';
const UPLOAD_ID = 'ph_0123456789abcdef01234567';
const KEY = `users/u-1/avatar/${UPLOAD_ID}.jpg`;

function setup(avatarUrl: string | null = null) {
  const real = new R2StorageService({ get: () => ({}) } as never);
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 'u-1', avatarUrl }),
      update: jest.fn(),
    },
  };
  const stub = {
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
  const storage = Object.assign(stub, {
    presignPhoto: (folder: string, type: string, size: number) =>
      real.presignPhoto.call(stub as unknown as R2StorageService, folder, type, size),
    confirmPhoto: (folder: string, uploadId: string, type: string) =>
      real.confirmPhoto.call(stub as unknown as R2StorageService, folder, uploadId, type),
    ownedKey: (url: string | null, folder: string) =>
      real.ownedKey.call(stub as unknown as R2StorageService, url, folder),
  });
  const audit = { record: jest.fn() };
  const service = new AvatarService(
    prisma as unknown as PrismaService,
    storage as unknown as R2StorageService,
    audit as unknown as AuditService,
  );
  return { prisma, storage, audit, service };
}

describe('AvatarService', () => {
  it('signs an upload under the caller’s own account, whatever their role', async () => {
    const { prisma, storage, service } = setup();

    const result = await service.uploadUrl('clerk_client', {
      contentType: 'image/jpeg',
      sizeBytes: 480_000,
    });

    // The account by its Clerk id only: no role, no chef profile is looked at.
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { clerkUserId: 'clerk_client' },
      select: { id: true, avatarUrl: true },
    });
    const [[key]] = storage.createUploadUrl.mock.calls as unknown as [[string]];
    expect(key).toMatch(/^users\/u-1\/avatar\/ph_[a-f0-9]{24}\.jpg$/);
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
    const { prisma, storage, service } = setup(`${BASE}/users/u-1/avatar/old.jpg`);

    const result = await service.confirm('clerk_1', {
      uploadId: UPLOAD_ID,
      contentType: 'image/jpeg',
    });

    expect(storage.assertUploaded).toHaveBeenCalledWith(KEY, 'image/jpeg');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: { avatarUrl: `${BASE}/${KEY}` },
    });
    expect(storage.delete).toHaveBeenCalledWith('users/u-1/avatar/old.jpg');
    expect(result).toEqual({ avatarUrl: `${BASE}/${KEY}` });
  });

  it('never deletes a file outside this account’s photo folder', async () => {
    // Another account’s photo, and a dish photo.
    for (const url of [
      `${BASE}/users/u-2/avatar/ph_x.jpg`,
      `${BASE}/chefs/cp-1/dishes/d1/ph_x.jpg`,
    ]) {
      const { storage, service } = setup(url);
      await service.removeOwn('clerk_1');
      expect(storage.delete).not.toHaveBeenCalled();
    }
  });

  it('lets an admin take a photo down, on the record', async () => {
    const { prisma, storage, audit, service } = setup(`${BASE}/${KEY}`);

    await service.takeDown('u-1', 'admin-1');

    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u-1' } }),
    );
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: { avatarUrl: null },
    });
    expect(storage.delete).toHaveBeenCalledWith(KEY);
    expect(audit.record).toHaveBeenCalledWith({
      actorType: 'admin',
      actorUserId: 'admin-1',
      action: 'user.avatar_removed',
      subjectType: 'user',
      subjectId: 'u-1',
    });
  });

  it('answers 404 for an unknown account', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.removeOwn('clerk_9')).rejects.toBeInstanceOf(NotFoundException);
  });
});
