import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { MealStatus, Prisma } from '../../generated/prisma/client';
import { CHEF, codeOf, dishRow, harness, readyDishRow } from './dishes.test-helpers';
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
          steps: [{ text: 'Éplucher', type: 'preparation', durationMinutes: 10 }],
        },
      });

      const { data } = meal.create.mock.calls[0][0];
      expect(data).toMatchObject({
        chefProfileId: CHEF.id,
        createdByUserId: CHEF.userId,
        status: MealStatus.draft,
        prepTime: 20,
        ingredients: [{ name: 'Ail', qty: 4, unit: 'gousse', aisle: 'fruits-legumes' }],
        steps: [{ order: 1, text: 'Éplucher', type: 'preparation', durationMinutes: 10 }],
      });
      expect(data.reheating).toBe(Prisma.DbNull);
    });

    it('stores the optional ingredient fields and the equipment, with their defaults', async () => {
      const { meal, access, prisma } = harness();

      await new DishesService(prisma, access).create('clerk_1', {
        name: 'Mafé',
        prepMinutes: 30,
        equipment: ['Cocotte'],
        recipe: {
          ingredients: [
            { name: 'Arachide', qty: 200, unit: 'g', aisle: 'epicerie' },
            {
              name: 'Sel',
              qty: 1,
              unit: 'pincée',
              aisle: 'epicerie',
              link: 'https://example.com/sel',
              toVerify: true,
              fixedQuantity: true,
            },
          ],
          steps: [{ text: 'Mijoter' }],
        },
      });

      const { data } = meal.create.mock.calls[0][0];
      expect(data.equipment).toEqual(['Cocotte']);
      expect(data.ingredients).toEqual([
        {
          name: 'Arachide',
          qty: 200,
          unit: 'g',
          aisle: 'epicerie',
          link: null,
          toVerify: false,
          fixedQuantity: false,
          catalogIngredientId: null,
        },
        {
          name: 'Sel',
          qty: 1,
          unit: 'pincée',
          aisle: 'epicerie',
          link: 'https://example.com/sel',
          toVerify: true,
          fixedQuantity: true,
          catalogIngredientId: null,
        },
      ]);
    });

    it('stores the reheating modes of the list in force, and refuses one outside it', async () => {
      const { meal, access, prisma } = harness();
      const service = new DishesService(prisma, access);

      await service.create('clerk_1', {
        name: 'Mafé',
        prepMinutes: 30,
        recipe: {
          ingredients: [],
          steps: [],
          reheating: {
            modes: ['oven', 'steam'],
            minutes: 15,
            container: 'Boîte en verre',
          },
        },
      });
      expect(meal.create.mock.calls[0][0].data.reheating).toEqual({
        modes: ['oven', 'steam'],
        mode: 'oven',
        temperature: null,
        minutes: 15,
        note: null,
        container: 'Boîte en verre',
      });

      const error = await service
        .create('clerk_1', {
          name: 'x',
          prepMinutes: 1,
          recipe: { ingredients: [], steps: [], reheating: { modes: ['flambe'] } },
        })
        .catch((e: unknown) => e);
      expect(codeOf(error).code).toBe('VALIDATION_FAILED');
    });

    it('links a line to the common ingredient list, and refuses an unknown one', async () => {
      const { meal, catalogIngredient, access, prisma } = harness();
      const service = new DishesService(prisma, access);
      const line = { name: 'Tomate', qty: 2, unit: 'pièce', aisle: 'fruits-legumes' };
      const id = '5b1f3c2e-8a44-4d0e-9f21-3c6a7e9b0d12';

      catalogIngredient.count.mockResolvedValueOnce(1);
      await service.create('clerk_1', {
        name: 'Salade',
        prepMinutes: 5,
        recipe: { ingredients: [{ ...line, catalogIngredientId: id }], steps: [] },
      });
      const lines = meal.create.mock.calls[0][0].data.ingredients as {
        catalogIngredientId: string;
      }[];
      expect(lines[0].catalogIngredientId).toBe(id);

      catalogIngredient.count.mockResolvedValueOnce(0);
      const error = await service
        .create('clerk_1', {
          name: 'Salade',
          prepMinutes: 5,
          recipe: { ingredients: [{ ...line, catalogIngredientId: id }], steps: [] },
        })
        .catch((e: unknown) => e);
      expect(codeOf(error).code).toBe('VALIDATION_FAILED');
    });

    it('computes the diets and seasons of a recipe linked to the common list (§4.8)', async () => {
      const { meal, catalogIngredient, access, prisma } = harness();
      const id = '5b1f3c2e-8a44-4d0e-9f21-3c6a7e9b0d12';
      catalogIngredient.count.mockResolvedValue(1);
      catalogIngredient.findMany.mockResolvedValue([
        { id, diets: ['vegan', 'vegetarian'], seasonMonths: [6, 7] },
      ]);

      await new DishesService(prisma, access).create('clerk_1', {
        name: 'Salade',
        prepMinutes: 5,
        declaredDiets: ['halal'],
        profiles: ['budget'],
        personalTags: ['été'],
        recipe: {
          ingredients: [
            {
              name: 'Tomate',
              qty: 2,
              unit: 'pièce',
              aisle: 'fruits-legumes',
              catalogIngredientId: id,
            },
          ],
          steps: [],
        },
      });

      expect(meal.create.mock.calls[0][0].data).toMatchObject({
        declaredDiets: ['halal'],
        profiles: ['budget'],
        personalTags: ['été'],
        classification: { diets: ['vegan', 'vegetarian'], seasonMonths: [6, 7] },
      });
    });

    it('refuses a profile outside the list in force', async () => {
      const { access, prisma } = harness();

      const error = await new DishesService(prisma, access)
        .create('clerk_1', { name: 'x', prepMinutes: 1, profiles: ['astronaute'] })
        .catch((e: unknown) => e);

      expect(codeOf(error).code).toBe('VALIDATION_FAILED');
    });

    it('refuses a recipe beyond a cap with 422 LIMIT_REACHED', async () => {
      const { meal, access, prisma } = harness();
      const line = { name: 'Ail', qty: 1, unit: 'gousse', aisle: 'fruits-legumes' };

      const error = await new DishesService(prisma, access)
        .create('clerk_1', {
          name: 'x',
          prepMinutes: 1,
          recipe: { ingredients: Array(61).fill(line), steps: [] },
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(codeOf(error)).toMatchObject({
        code: 'LIMIT_REACHED',
        limit: 'ingredients',
        max: 60,
      });
      expect(meal.create).not.toHaveBeenCalled();
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

  describe('readiness and versions (Recettes §4.11, R6)', () => {
    /** A dish row the writes really change, as the database would. */
    const stored = (h: ReturnType<typeof harness>, row: ReturnType<typeof dishRow>) => {
      let state = row;
      h.meal.findUnique.mockImplementation(async () => state);
      h.meal.update.mockImplementation(async ({ data }: { data: object }) => {
        state = { ...state, ...data };
        return state;
      });
    };

    it('says what is missing to be ready', async () => {
      const { access, prisma } = harness();

      const view = await new DishesService(prisma, access).get('clerk_1', 'dish-1');

      expect(view.readiness.ready).toBe(false);
      expect(view.readiness.problems.map((p) => p.code)).toContain(
        'ALLERGENS_UNVERIFIED',
      );
    });

    it('keeps the save of a recipe that is not ready out of any version', async () => {
      const h = harness();

      await new DishesService(h.prisma, h.access).update('clerk_1', 'dish-1', {
        portions: 6,
      });

      expect(h.meal.update).toHaveBeenCalledTimes(1);
      expect(h.meal.update.mock.calls[0][0].data).toMatchObject({
        portions: 6,
        versionPending: true,
      });
      expect(h.mealRecipeVersion.create).not.toHaveBeenCalled();
    });

    it('makes a version, its content kept, when a save leaves the recipe ready', async () => {
      const h = harness();
      stored(h, readyDishRow());
      h.mealRecipeVersion.findUnique.mockResolvedValue({ id: 'kept-v2' });

      const view = await new DishesService(h.prisma, h.access).update(
        'clerk_1',
        'dish-1',
        {
          portions: 6,
        },
      );

      expect(h.meal.update.mock.calls[1][0].data).toEqual({
        recipeVersion: 3,
        versionPending: false,
      });
      expect(h.mealRecipeVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ mealId: 'dish-1', version: 3, portions: 6 }),
      });
      expect(view.recipeVersion).toBe(3);
    });

    it('makes no version when nothing of the recipe changes', async () => {
      const h = harness();
      stored(h, readyDishRow());

      await new DishesService(h.prisma, h.access).update('clerk_1', 'dish-1', {
        description: 'Plus de thym.',
        recipe: {
          ingredients: [{ name: 'Ail', qty: 4, unit: 'gousse', aisle: 'fruits-legumes' }],
          steps: [{ text: 'Enfourner 55 min.', type: 'cuisson', durationMinutes: 55 }],
          reheating: { modes: ['microwave'] },
          storage: { method: 'fridge', days: 3 },
        },
      });

      expect(h.meal.update).toHaveBeenCalledTimes(1);
      expect(h.meal.update.mock.calls[0][0].data).not.toHaveProperty('versionPending');
      expect(h.mealRecipeVersion.create).not.toHaveBeenCalled();
    });

    it('keeps the pending changes in a version when the allergens are confirmed', async () => {
      const h = harness();
      // Not ready (a step has no type), but the ingredients just verified must be
      // the ones a booking cooks from.
      stored(h, readyDishRow({ steps: ['Éplucher'], versionPending: true }));
      h.mealRecipeVersion.findUnique.mockResolvedValue({ id: 'kept-v2' });

      await new DishesService(h.prisma, h.access).confirmAllergens('clerk_1', 'dish-1');

      expect(h.meal.update.mock.calls[1][0].data).toEqual({
        recipeVersion: 3,
        versionPending: false,
      });
      expect(h.mealRecipeVersion.create).toHaveBeenCalledTimes(1);
    });

    it('numbers a first version without moving the number when none was kept', async () => {
      const h = harness();
      stored(h, readyDishRow({ allergensVerifiedAt: null, versionPending: true }));

      await new DishesService(h.prisma, h.access).confirmAllergens('clerk_1', 'dish-1');

      expect(h.meal.update.mock.calls[1][0].data).toEqual({ versionPending: false });
      expect(h.mealRecipeVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ version: 2 }),
      });
    });
  });

  describe('allergen verification (Recettes §4.9)', () => {
    it('records when the chef confirms the allergens', async () => {
      const { meal, access, prisma } = harness();

      await new DishesService(prisma, access).confirmAllergens('clerk_1', 'dish-1');

      expect(meal.update).toHaveBeenCalledWith({
        where: { id: 'dish-1', chefProfileId: CHEF.id },
        data: { allergensVerifiedAt: expect.any(Date) },
      });
    });

    it('refuses to confirm a dish that declares nothing, with 422 ALLERGENS_REQUIRED', async () => {
      const { meal, access, prisma } = harness();
      meal.findUnique.mockResolvedValue(dishRow({ allergens: [], allergensNone: false }));

      const error = await new DishesService(prisma, access)
        .confirmAllergens('clerk_1', 'dish-1')
        .catch((e: unknown) => e);

      expect(codeOf(error).code).toBe('ALLERGENS_REQUIRED');
      expect(meal.update).not.toHaveBeenCalled();
    });

    it('clears it when an ingredient changes, not when a quantity does', async () => {
      const { meal, access, prisma } = harness();
      const ail = { name: 'Ail', qty: 4, unit: 'gousse', aisle: 'fruits-legumes' };
      meal.findUnique.mockResolvedValue(
        dishRow({ ingredients: [ail], allergensVerifiedAt: new Date() }),
      );
      const service = new DishesService(prisma, access);

      await service.update('clerk_1', 'dish-1', {
        recipe: { ingredients: [{ ...ail, qty: 6 }], steps: [] },
      });
      await service.update('clerk_1', 'dish-1', {
        recipe: { ingredients: [ail, { ...ail, name: 'Sésame' }], steps: [] },
      });

      expect(meal.update.mock.calls[0][0].data).not.toHaveProperty('allergensVerifiedAt');
      expect(meal.update.mock.calls[1][0].data.allergensVerifiedAt).toBeNull();
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

      for (const edit of [{ name: ' ' }, { allergens: [] }]) {
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

    it('refuses a recipe that is not ready with 422 RECIPE_NOT_READY, every point listed', async () => {
      const { meal, access, prisma } = harness();
      meal.findUnique.mockResolvedValue(
        readyDishRow({ allergens: [], description: null }),
      );

      const error = await new DishesService(prisma, access)
        .publish('clerk_1', 'dish-1')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(codeOf(error)).toMatchObject({
        code: 'RECIPE_NOT_READY',
        problems: [
          expect.objectContaining({ code: 'ALLERGENS_REQUIRED', field: 'allergens' }),
          expect.objectContaining({ field: 'description' }),
        ],
      });
      expect(meal.update).not.toHaveBeenCalled();
    });

    it('publishes without a photo: a real one is required, but not blocking yet', async () => {
      const { meal, access, prisma } = harness();
      meal.findUnique.mockResolvedValue(readyDishRow({ imageUrl: null }));

      await new DishesService(prisma, access).publish('clerk_1', 'dish-1');

      expect(meal.update.mock.calls[0][0].data.status).toBe(MealStatus.published);
    });

    it('publishes, stamps publishedAt and queues it for a first review', async () => {
      const { meal, access, prisma } = harness();
      meal.findUnique.mockResolvedValue(readyDishRow());

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
        readyDishRow({
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
