import { ConflictException, UnprocessableEntityException } from '@nestjs/common';

import { MealStatus } from '../../generated/prisma/client';
import { R2StorageService } from '../../integrations/r2-storage.service';
import { DishPhotosService } from './dish-photos.service';
import { CHEF, codeOf, dishRow, harness } from './dishes.test-helpers';

const BASE = 'https://photos.labsfood.fr';
const UPLOAD_ID = 'ph_0123456789abcdef01234567';
const KEY = `chefs/${CHEF.id}/dishes/dish-1/${UPLOAD_ID}.jpg`;

function storage(head: { sizeBytes: number; contentType: string } | null = null) {
  const real = new R2StorageService({ get: () => ({}) } as never);
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
    head: jest.fn(async () => head),
    sniff: jest.fn(async () => head?.contentType ?? null),
    publicUrl: jest.fn((key: string) => `${BASE}/${key}`),
    keyOf: jest.fn((url: string | null) =>
      url?.startsWith(`${BASE}/`) ? url.slice(BASE.length + 1) : null,
    ),
    delete: jest.fn(async () => undefined),
  };
  return Object.assign(stub, {
    // The real confirm check, run against the stubs above.
    assertUploaded: (key: string, contentType: string) =>
      real.assertUploaded.call(stub as unknown as R2StorageService, key, contentType),
  });
}

const service = (h: ReturnType<typeof harness>, s: ReturnType<typeof storage>) =>
  new DishPhotosService(h.prisma, h.access, s as unknown as R2StorageService);

describe('DishPhotosService (milestone 7)', () => {
  it('signs an upload under the owning chef and the dish, and nowhere else', async () => {
    const h = harness();
    const s = storage();

    const result = await service(h, s).uploadUrl('clerk_1', 'dish-1', {
      contentType: 'image/jpeg',
      sizeBytes: 480_000,
    });

    const [[key]] = s.createUploadUrl.mock.calls as unknown as [[string]];
    expect(key).toMatch(
      new RegExp(`^chefs/${CHEF.id}/dishes/dish-1/ph_[a-f0-9]{24}\\.jpg$`),
    );
    expect(result.uploadId).toMatch(/^ph_[a-f0-9]{24}$/);
  });

  it('refuses a file that is not a picture, or too large', async () => {
    const h = harness();
    for (const [contentType, sizeBytes] of [
      ['application/pdf', 1000],
      ['image/png', 6 * 1024 * 1024],
    ] as const) {
      await expect(
        service(h, storage()).uploadUrl('clerk_1', 'dish-1', { contentType, sizeBytes }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    }
  });

  it('refuses another chef’s dish with 403 CONTENT_NOT_OWNED', async () => {
    const h = harness();
    h.meal.findUnique.mockResolvedValue(dishRow({ chefProfileId: 'chef-2' }));

    const error = await service(h, storage())
      .uploadUrl('clerk_1', 'dish-1', { contentType: 'image/jpeg', sizeBytes: 1000 })
      .catch((e: unknown) => e);

    expect(codeOf(error).code).toBe('CONTENT_NOT_OWNED');
  });

  it('answers 409 when nothing was uploaded', async () => {
    const h = harness();
    await expect(
      service(h, storage(null)).confirm('clerk_1', 'dish-1', {
        uploadId: UPLOAD_ID,
        contentType: 'image/jpeg',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('deletes and refuses a file that does not match what was announced', async () => {
    const h = harness();
    const s = storage({ sizeBytes: 1000, contentType: 'text/html' });

    await expect(
      service(h, s).confirm('clerk_1', 'dish-1', {
        uploadId: UPLOAD_ID,
        contentType: 'image/jpeg',
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(s.delete).toHaveBeenCalledWith(KEY);
  });

  it('makes it the photo, requeues a published dish and deletes the old photo', async () => {
    const h = harness();
    h.meal.findUnique.mockResolvedValue(
      dishRow({
        status: MealStatus.published,
        reviewedAt: new Date('2026-09-20'),
        imageUrl: `${BASE}/chefs/${CHEF.id}/dishes/dish-1/old.jpg`,
      }),
    );
    const s = storage({ sizeBytes: 480_000, contentType: 'image/jpeg' });

    await service(h, s).confirm('clerk_1', 'dish-1', {
      uploadId: UPLOAD_ID,
      contentType: 'image/jpeg',
    });

    expect(h.meal.update.mock.calls[0][0].data).toMatchObject({
      imageUrl: `${BASE}/${KEY}`,
      reviewReason: 'edited-after-review',
    });
    expect(s.delete).toHaveBeenCalledWith(`chefs/${CHEF.id}/dishes/dish-1/old.jpg`);
  });

  it('refuses bytes that are not the picture announced, whatever the header said', async () => {
    const h = harness();
    const s = storage({ sizeBytes: 1000, contentType: 'image/jpeg' });
    s.sniff.mockResolvedValue(null);

    await expect(
      service(h, s).confirm('clerk_1', 'dish-1', {
        uploadId: UPLOAD_ID,
        contentType: 'image/jpeg',
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(s.delete).toHaveBeenCalledWith(KEY);
  });

  it('never deletes a photo that is not this dish’s own', async () => {
    const h = harness();
    h.meal.findUnique.mockResolvedValue(
      dishRow({ imageUrl: `${BASE}/chefs/chef-2/dishes/other/their.jpg` }),
    );
    const s = storage();

    await service(h, s).remove('clerk_1', 'dish-1');

    expect(s.delete).not.toHaveBeenCalled();
  });

  it('answers 503 PHOTOS_UNAVAILABLE when R2 is not configured', async () => {
    const h = harness();
    const unconfigured = new R2StorageService({ get: () => ({}) } as never);

    const error = await new DishPhotosService(h.prisma, h.access, unconfigured)
      .uploadUrl('clerk_1', 'dish-1', { contentType: 'image/jpeg', sizeBytes: 1000 })
      .catch((e: unknown) => e);

    expect(codeOf(error).code).toBe('PHOTOS_UNAVAILABLE');
  });
});
