import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { MealStatus, Prisma } from '../../generated/prisma/client';
import { CHEF, codeOf, dishRow, harness } from './dishes.test-helpers';
import { DishesService } from './dishes.service';

describe('DishesService', () => {
  describe('create', () => {
    it('creates a draft owned and authored by the chef, with a plain recipe', async () => {
      const { meal, access, prisma } = harness();
      const service = new DishesService(prisma, access);

      await service.create('clerk_1', {
        name: 'Poulet rôti aux herbes',
        prepMinutes: 20,
        allergens: ['celery'],
        recipe: {
          ingredients: [{ name: 'Ail', qty: 4, unit: 'gousse', aisle: 'fruits-legumes' }],
          steps: ['Éplucher'],
        },
      });

      const { data } = meal.create.mock.calls[0][0];
      expect(data).toMatchObject({
        chefProfileId: CHEF.id,
        createdByUserId: CHEF.userId,
        status: MealStatus.draft,
        prepTime: 20,
        ingredients: [{ name: 'Ail', qty: 4, unit: 'gousse', aisle: 'fruits-legumes' }],
        steps: ['Éplucher'],
      });
      expect(data.reheating).toBe(Prisma.DbNull);
    });

    it('refuses an unapproved batch cooker with 403 CHEF_NOT_VERIFIED', async () => {
      const { access, prisma } = harness({ chef: { ...CHEF, isVerified: false } });
      const error = await new DishesService(prisma, access)
        .create('clerk_1', { name: 'x', prepMinutes: 1 })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(codeOf(error).code).toBe('CHEF_NOT_VERIFIED');
    });

    it('refuses "none of the 14" next to a listed allergen', async () => {
      const { access, prisma } = harness();
      await expect(
        new DishesService(prisma, access).create('clerk_1', {
          name: 'x',
          prepMinutes: 1,
          allergens: ['milk'],
          allergensNone: true,
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('answers 404 for an account with no chef profile', async () => {
      const { access, prisma } = harness({ chef: null });
      await expect(
        new DishesService(prisma, access).list('clerk_1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('access to another chef’s dish (§8)', () => {
    const theirs = () => {
      const h = harness();
      h.meal.findUnique.mockResolvedValue(dishRow({ chefProfileId: 'chef-2' }));
      return { ...h, service: new DishesService(h.prisma, h.access) };
    };

    it('is missing on a read', async () => {
      await expect(theirs().service.get('clerk_1', 'dish-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('is 403 CONTENT_NOT_OWNED on every write', async () => {
      const { service, meal } = theirs();
      for (const write of [
        () => service.update('clerk_1', 'dish-1', { name: 'Mine now' }),
        () => service.remove('clerk_1', 'dish-1'),
        () => service.publish('clerk_1', 'dish-1'),
        () => service.unpublish('clerk_1', 'dish-1'),
      ]) {
        const error = await write().catch((e: unknown) => e);
        expect(codeOf(error).code).toBe('CONTENT_NOT_OWNED');
      }
      expect(meal.update).not.toHaveBeenCalled();
      expect(meal.delete).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('keeps a published dish published and writes only the owner’s row', async () => {
      const { meal, access, prisma } = harness();
      meal.findUnique.mockResolvedValue(dishRow({ status: MealStatus.published }));

      await new DishesService(prisma, access).update('clerk_1', 'dish-1', {
        description: 'Plus de thym.',
      });

      expect(meal.update).toHaveBeenCalledWith({
        where: { id: 'dish-1', chefProfileId: CHEF.id },
        data: { description: 'Plus de thym.' },
      });
    });

    it('refuses an edit that would leave a published dish unpublishable', async () => {
      const { meal, access, prisma } = harness();
      meal.findUnique.mockResolvedValue(dishRow({ status: MealStatus.published }));
      const service = new DishesService(prisma, access);

      for (const edit of [{ country: null }, { allergens: [] }]) {
        await expect(service.update('clerk_1', 'dish-1', edit)).rejects.toBeInstanceOf(
          UnprocessableEntityException,
        );
      }
      expect(meal.update).not.toHaveBeenCalled();
    });

    it('lets a draft be emptied freely', async () => {
      const { meal, access, prisma } = harness();

      await new DishesService(prisma, access).update('clerk_1', 'dish-1', {
        country: null,
      });

      expect(meal.update).toHaveBeenCalled();
    });

    it('makes a new recipe version when the recipe or portions change, not otherwise', async () => {
      const { meal, access, prisma } = harness();
      const service = new DishesService(prisma, access);

      await service.update('clerk_1', 'dish-1', { portions: 6 });
      await service.update('clerk_1', 'dish-1', { description: 'Plus de thym.' });

      expect(meal.update.mock.calls[0][0].data.recipeVersion).toEqual({ increment: 1 });
      expect(meal.update.mock.calls[1][0].data).not.toHaveProperty('recipeVersion');
    });

    it('checks the declaration as it will be after the change', async () => {
      const { meal, access, prisma } = harness();
      meal.findUnique.mockResolvedValue(dishRow({ allergens: ['milk'] }));

      await expect(
        new DishesService(prisma, access).update('clerk_1', 'dish-1', {
          allergensNone: true,
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  describe('publish (§3.3)', () => {
    it('refuses a chef whose dossier is no longer validated', async () => {
      const { access, prisma } = harness({ dossier: 'suspended' });
      const error = await new DishesService(prisma, access)
        .publish('clerk_1', 'dish-1')
        .catch((e: unknown) => e);

      expect(codeOf(error).code).toBe('CHEF_NOT_VERIFIED');
    });

    it('refuses an unanswered allergen declaration, listing the problem', async () => {
      const { meal, access, prisma } = harness();
      meal.findUnique.mockResolvedValue(dishRow({ allergens: [] }));

      const error = await new DishesService(prisma, access)
        .publish('clerk_1', 'dish-1')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(codeOf(error)).toMatchObject({
        code: 'ALLERGENS_REQUIRED',
        problems: [expect.objectContaining({ field: 'allergens' })],
      });
    });

    it('publishes, stamps publishedAt and queues it for a first review', async () => {
      const { meal, access, prisma } = harness();

      await new DishesService(prisma, access).publish('clerk_1', 'dish-1');

      const { where, data } = meal.update.mock.calls[0][0];
      // The status read is part of the write, so an admin decision is never overwritten.
      expect(where).toEqual({
        id: 'dish-1',
        chefProfileId: CHEF.id,
        status: MealStatus.draft,
      });
      expect(data.status).toBe(MealStatus.published);
      expect(data.publishedAt).toBeInstanceOf(Date);
      expect(data.reviewReason).toBe('never-reviewed');
    });

    it('puts a corrected suspended dish back first in the queue, and clears the removal', async () => {
      const { meal, access, prisma } = harness();
      meal.findUnique.mockResolvedValue(
        dishRow({
          status: MealStatus.suspended,
          reviewedAt: new Date('2026-09-20'),
          moderationReason: 'Le lait n’est pas déclaré.',
          moderationReasonCode: 'allergens-incomplete',
        }),
      );

      await new DishesService(prisma, access).publish('clerk_1', 'dish-1');

      expect(meal.update.mock.calls[0][0].data).toMatchObject({
        status: MealStatus.published,
        reviewReason: 'republished-after-suspension',
        moderationReason: null,
        moderationReasonCode: null,
      });
    });

    it('cannot skip review by unpublishing, editing allergens and republishing', async () => {
      const { meal, access, prisma } = harness();
      meal.findUnique.mockResolvedValue(
        dishRow({ status: MealStatus.draft, reviewedAt: new Date('2026-09-20') }),
      );

      await new DishesService(prisma, access).update('clerk_1', 'dish-1', {
        allergens: ['celery', 'milk'],
      });

      expect(meal.update.mock.calls[0][0].data.reviewReason).toBe('edited-after-review');
    });

    it('sends a reviewed dish back to the queue when its allergens change', async () => {
      const { meal, access, prisma } = harness();
      meal.findUnique.mockResolvedValue(
        dishRow({ status: MealStatus.published, reviewedAt: new Date('2026-09-20') }),
      );

      await new DishesService(prisma, access).update('clerk_1', 'dish-1', {
        allergens: ['celery', 'milk'],
      });

      expect(meal.update.mock.calls[0][0].data.reviewReason).toBe('edited-after-review');
    });

    it('changes nothing for a dish already published', async () => {
      const { meal, access, prisma } = harness();
      meal.findUnique.mockResolvedValue(dishRow({ status: MealStatus.published }));

      await new DishesService(prisma, access).publish('clerk_1', 'dish-1');

      expect(meal.update).not.toHaveBeenCalled();
    });
  });

  it('keeps a suspension, and its reason, through an edit and an unpublish', async () => {
    const { meal, access, prisma } = harness();
    meal.findUnique.mockResolvedValue(
      dishRow({
        status: MealStatus.suspended,
        moderationReason: 'Le lait n’est pas déclaré.',
      }),
    );
    const service = new DishesService(prisma, access);

    await service.update('clerk_1', 'dish-1', { description: 'Corrigé.' });
    await service.unpublish('clerk_1', 'dish-1');

    expect(meal.update).toHaveBeenCalledTimes(1);
    const { data } = meal.update.mock.calls[0][0];
    expect(data).not.toHaveProperty('status');
    expect(data).not.toHaveProperty('moderationReason');
  });

  it('unpublishes back to draft', async () => {
    const { meal, access, prisma } = harness();
    meal.findUnique.mockResolvedValue(dishRow({ status: MealStatus.published }));

    await new DishesService(prisma, access).unpublish('clerk_1', 'dish-1');

    expect(meal.update.mock.calls[0][0].data).toEqual({ status: MealStatus.draft });
  });

  it('keeps a booked dish, answering 409', async () => {
    const { meal, access, prisma } = harness();
    meal.delete.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('fk', {
        code: 'P2003',
        clientVersion: 't',
      }),
    );

    await expect(
      new DishesService(prisma, access).remove('clerk_1', 'dish-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
