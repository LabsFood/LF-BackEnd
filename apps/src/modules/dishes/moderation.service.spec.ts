import { ConflictException, NotFoundException } from '@nestjs/common';

import { MealStatus } from '../../generated/prisma/client';
import { codeOf, dishRow, harness } from './dishes.test-helpers';
import { ModerationService } from './moderation.service';
import { R2StorageService } from '../../integrations/r2-storage.service';

const keyOf = (url: string | null) => url?.replace('https://photos/', '') ?? null;
const storage = {
  keyOf: jest.fn(keyOf),
  ownedKey: jest.fn((url: string | null, folder: string) => {
    const key = keyOf(url);
    return key?.startsWith(folder) ? key : null;
  }),
  delete: jest.fn(async () => undefined),
};

const service = (h: ReturnType<typeof harness>) =>
  new ModerationService(
    h.prisma,
    h.audit,
    h.mailer,
    storage as unknown as R2StorageService,
  );

const REASON =
  'Les allergènes ne mentionnent pas le lait, alors que la recette contient du beurre.';

/** A published chef dish, as `find` loads it for moderation. */
const published = (overrides: Record<string, unknown> = {}) => ({
  ...dishRow({ status: MealStatus.published, ...overrides }),
  chefProfile: { id: 'chef-1', user: { email: 'marie@exemple.fr', fullName: 'Marie' } },
});

describe('ModerationService (§4)', () => {
  describe('the queue', () => {
    it('reads published chef content waiting for review, dishes and menus', async () => {
      const h = harness();
      await service(h).list({ review: 'pending' });

      const where = {
        chefProfileId: { not: null },
        reviewPendingSince: { not: null },
        status: MealStatus.published,
      };
      expect(h.meal.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
      expect(h.menu.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
    });

    it('puts a republication first, then the longest wait', async () => {
      const h = harness();
      const chefProfile = { id: 'chef-1', displayName: 'Marie' };
      h.meal.findMany.mockResolvedValue([
        dishRow({
          id: 'old',
          chefProfile,
          reviewReason: 'never-reviewed',
          reviewPendingSince: new Date('2026-09-01'),
        }),
        dishRow({
          id: 'back',
          chefProfile,
          reviewReason: 'republished-after-suspension',
          reviewPendingSince: new Date('2026-09-20'),
        }),
        dishRow({
          id: 'new',
          chefProfile,
          reviewReason: 'edited-after-review',
          reviewPendingSince: new Date('2026-09-10'),
          customAllergens: ['sarrasin'],
        }),
      ]);

      const { data } = await service(h).list({ review: 'pending', type: 'dish' });

      expect(data.map((item) => item.id)).toEqual(['back', 'old', 'new']);
      expect(data[2].flags).toEqual(['custom-allergen', 'edited-after-review']);
    });
  });

  it('marks content reviewed in one call, and records it', async () => {
    const h = harness();
    h.meal.updateMany.mockResolvedValue({ count: 1 });

    await service(h).review('dish', 'dish-1', 'admin-1', { outcome: 'ok' });

    expect(h.meal.updateMany).toHaveBeenCalledWith({
      where: { id: 'dish-1', chefProfileId: { not: null } },
      data: {
        reviewedAt: expect.any(Date),
        reviewPendingSince: null,
        reviewReason: null,
      },
    });
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'content.reviewed', actorUserId: 'admin-1' }),
    );
  });

  it('answers 404 for Lab’s Food content, which is not moderated here', async () => {
    const h = harness();
    await expect(
      service(h).review('dish', 'labs-food', 'admin-1', { outcome: 'ok' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('taking content down', () => {
    it('refuses a reason shorter than 15 characters with REASON_REQUIRED', async () => {
      const h = harness();
      const error = await service(h)
        .moderate('dish', 'dish-1', 'admin-1', { status: 'suspended', reason: 'Non.' })
        .catch((e: unknown) => e);

      expect(codeOf(error).code).toBe('REASON_REQUIRED');
      expect(h.meal.updateMany).not.toHaveBeenCalled();
    });

    it('suspends a published dish, keeps the reason as written, and emails the chef', async () => {
      const h = harness();
      h.meal.findFirst.mockResolvedValue(published());
      h.meal.updateMany.mockResolvedValue({ count: 1 });
      h.menu.findMany.mockResolvedValue([{ title: 'Semaine provençale' }]);

      await service(h).moderate('dish', 'dish-1', 'admin-1', {
        status: 'suspended',
        reason: `  ${REASON}  `,
        reasonCode: 'allergens-incomplete',
      });

      expect(h.meal.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'dish-1',
          status: MealStatus.published,
          chefProfileId: { not: null },
        },
        data: expect.objectContaining({
          status: MealStatus.suspended,
          moderationReason: REASON,
          moderationReasonCode: 'allergens-incomplete',
        }),
      });
      expect(h.mailer.contentSuspended).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'marie@exemple.fr',
          reason: REASON,
          menus: ['Semaine provençale'],
        }),
      );
      expect(h.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'content.suspended' }),
      );
    });

    it('takes the photo down too when it may be the problem', async () => {
      const h = harness();
      h.meal.findFirst.mockResolvedValue(
        published({ imageUrl: 'https://photos/chefs/chef-1/dishes/dish-1/ph_1.jpg' }),
      );
      h.meal.updateMany.mockResolvedValue({ count: 1 });

      await service(h).moderate('dish', 'dish-1', 'admin-1', {
        status: 'suspended',
        reason: 'Photo sans rapport avec le plat, et choquante.',
        reasonCode: 'inappropriate-content',
      });

      expect(h.meal.updateMany.mock.calls[0][0]).toMatchObject({
        data: { imageUrl: null },
      });
      expect(storage.delete).toHaveBeenCalledWith('chefs/chef-1/dishes/dish-1/ph_1.jpg');
    });

    it('takes a shared Lab’s Food photo off the copy, but never deletes Lab’s Food’s file', async () => {
      const h = harness();
      storage.delete.mockClear();
      // An adopted suggestion shows the suggestion’s own file.
      h.meal.findFirst.mockResolvedValue(
        published({ imageUrl: 'https://photos/labsfood/dishes/meal-9/ph_1.jpg' }),
      );
      h.meal.updateMany.mockResolvedValue({ count: 1 });

      await service(h).moderate('dish', 'dish-1', 'admin-1', {
        status: 'suspended',
        reason: 'Photo sans rapport avec le plat, et choquante.',
        reasonCode: 'inappropriate-content',
      });

      expect(h.meal.updateMany.mock.calls[0][0]).toMatchObject({
        data: { imageUrl: null },
      });
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('does not email when asked not to', async () => {
      const h = harness();
      h.meal.findFirst.mockResolvedValue(published());
      h.meal.updateMany.mockResolvedValue({ count: 1 });

      await service(h).moderate('dish', 'dish-1', 'admin-1', {
        status: 'suspended',
        reason: REASON,
        notifyChef: false,
      });

      expect(h.mailer.contentSuspended).not.toHaveBeenCalled();
    });

    it('refuses to suspend what is not published', async () => {
      const h = harness();
      h.meal.findFirst.mockResolvedValue(published({ status: MealStatus.draft }));
      h.meal.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service(h).moderate('dish', 'dish-1', 'admin-1', {
          status: 'suspended',
          reason: REASON,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('lifts a suspension with a reason, clearing the removal', async () => {
      const h = harness();
      h.meal.findFirst.mockResolvedValue(published({ status: MealStatus.suspended }));
      h.meal.updateMany.mockResolvedValue({ count: 1 });

      await service(h).moderate('dish', 'dish-1', 'admin-1', {
        status: 'published',
        reason: 'Déclaration complétée par téléphone, lait ajouté.',
      });

      expect(h.meal.updateMany.mock.calls[0][0]).toMatchObject({
        where: { status: MealStatus.suspended },
        data: { status: MealStatus.published, moderationReason: null },
      });
      expect(h.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'content.reinstated' }),
      );
    });
  });

  it('counts recurring free-text values across batch cookers’ dishes', async () => {
    const h = harness();
    h.meal.findMany.mockResolvedValue([
      { customDiets: [], customAllergens: ['Sarrasin'] },
      { customDiets: ['pescétarien'], customAllergens: ['sarrasin'] },
    ]);

    await expect(service(h).customValues()).resolves.toEqual({
      diets: [{ value: 'pescétarien', count: 1 }],
      allergens: [{ value: 'Sarrasin', count: 2 }],
    });
  });
});
