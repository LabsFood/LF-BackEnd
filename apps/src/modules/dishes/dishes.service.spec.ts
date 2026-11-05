import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { MealStatus, Prisma } from '../../generated/prisma/client';
import {
  CHEF,
  codeOf,
  dishRow,
  entryRow,
  harness,
  READY_ENTRIES,
  READY_RECIPE,
  readyDishRow,
  stampedLine,
  withEntries,
} from './dishes.test-helpers';
import { DishesService } from './dishes.service';
import { readiness } from './domain/dishes.rules';

/**
 * A dish row the writes really change, as the database would: a `where` on an
 * outdated `lockVersion` matches nothing, and `{ increment }` adds up.
 */
const stored = (h: ReturnType<typeof harness>, row: ReturnType<typeof dishRow>) => {
  let state = row;
  h.meal.findUnique.mockImplementation(async () => state);
  h.meal.update.mockImplementation(
    async ({ where, data }: { where?: Record<string, unknown>; data: object }) => {
      if (where?.lockVersion !== undefined && where.lockVersion !== state.lockVersion) {
        throw noRowMatched();
      }
      const { lockVersion, ...rest } = data as { lockVersion?: unknown };
      state = {
        ...state,
        ...rest,
        ...(lockVersion !== undefined && {
          lockVersion:
            typeof lockVersion === 'object'
              ? state.lockVersion + (lockVersion as { increment: number }).increment
              : (lockVersion as number),
        }),
      };
      return state;
    },
  );
};

/** What Prisma throws when a write's `where` matches no row. */
const noRowMatched = () =>
  new Prisma.PrismaClientKnownRequestError('No record was found for an update.', {
    code: 'P2025',
    clientVersion: 't',
  });

describe('DishesService', () => {
  describe('create', () => {
    it('creates a draft owned and authored by the chef, with a plain recipe', async () => {
      const { meal, access, prisma } = harness();
      const service = new DishesService(prisma, access);

      await service.create('clerk_1', {
        name: 'Poulet rôti aux herbes',
        prepMinutes: 20,
        addedAllergens: ['celery'],
        recipe: {
          ingredients: [{ name: 'Ail', qty: 4, unit: 'clove', aisle: 'fruits-legumes' }],
          steps: [{ text: 'Éplucher', type: 'preparation', durationMinutes: 10 }],
        },
      });

      const { data } = meal.create.mock.calls[0][0];
      expect(data).toMatchObject({
        chefProfileId: CHEF.id,
        createdByUserId: CHEF.userId,
        status: MealStatus.draft,
        prepTime: 20,
        ingredients: [{ name: 'Ail', qty: 4, unit: 'clove', aisle: 'fruits-legumes' }],
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
              unit: 'pinch',
              aisle: 'epicerie',
              link: 'https://example.com/sel',
              toVerify: true,
              fixedQuantity: true,
              optional: true,
              precision: 'fin',
              preparation: 'moulu',
              group: 'Sauce',
              hiddenFromClient: true,
              rawText: 'une pincée de sel',
            },
            { name: 'Eau', qty: null, unit: null, toVerify: true },
          ],
          steps: [{ text: 'Mijoter' }],
          storage: {
            method: 'fridge',
            days: 3,
            freezable: true,
            freezerMonths: 3,
            thawing: 'Au frigo',
          },
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
          optional: false,
          precision: null,
          preparation: null,
          group: null,
          hiddenFromClient: false,
          rawText: null,
          // Written by the API: an unlinked line brings nothing yet (Recettes §6.1).
          allergens: [],
          incomplete: false,
        },
        {
          name: 'Sel',
          qty: 1,
          unit: 'pinch',
          aisle: 'epicerie',
          link: 'https://example.com/sel',
          toVerify: true,
          fixedQuantity: true,
          catalogIngredientId: null,
          optional: true,
          precision: 'fin',
          preparation: 'moulu',
          group: 'Sauce',
          hiddenFromClient: true,
          rawText: 'une pincée de sel',
          allergens: [],
          incomplete: false,
        },
        expect.objectContaining({ name: 'Eau', qty: null, unit: null, aisle: null }),
      ]);
      expect(data.storage).toEqual({
        method: 'fridge',
        days: 3,
        container: null,
        freezable: true,
        freezerMonths: 3,
        thawing: 'Au frigo',
      });
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
      const h = harness();
      const service = new DishesService(h.prisma, h.access);
      const id = '5b1f3c2e-8a44-4d0e-9f21-3c6a7e9b0d12';
      const recipe = {
        ingredients: [
          { name: 'tomates', qty: 2, unit: 'piece', catalogIngredientId: id },
        ],
        steps: [],
      };

      withEntries(h, [entryRow({ id, name: 'Tomate' })]);
      await service.create('clerk_1', { name: 'Salade', prepMinutes: 5, recipe });
      expect(h.meal.create.mock.calls[0][0].data.ingredients).toEqual([
        expect.objectContaining({ catalogIngredientId: id, name: 'Tomate' }),
      ]);

      withEntries(h, []);
      const error = await service
        .create('clerk_1', { name: 'Salade', prepMinutes: 5, recipe })
        .catch((e: unknown) => e);
      expect(codeOf(error)).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [expect.objectContaining({ field: 'recipe.ingredients[0]' })],
      });
      expect(h.meal.create).toHaveBeenCalledTimes(1);
    });

    it('refuses an inactive entry: a new dish has no line to keep it for (§8.1)', async () => {
      const h = harness();
      withEntries(h, [entryRow({ id: 'cat-old', status: 'inactive' })]);

      const error = await new DishesService(h.prisma, h.access)
        .create('clerk_1', {
          name: 'Salade',
          prepMinutes: 5,
          recipe: {
            ingredients: [
              { name: 'Tomate', qty: 2, unit: 'piece', catalogIngredientId: 'cat-old' },
            ],
            steps: [],
          },
        })
        .catch((e: unknown) => e);

      expect(codeOf(error).code).toBe('VALIDATION_FAILED');
      expect(h.meal.create).not.toHaveBeenCalled();
    });

    it('computes the allergens of a new recipe, its lock version left to the default', async () => {
      const h = harness();
      withEntries(h, READY_ENTRIES);

      await new DishesService(h.prisma, h.access).create('clerk_1', {
        name: 'Poulet rôti aux herbes',
        prepMinutes: 20,
        addedAllergens: ['mustard'],
        recipe: READY_RECIPE,
      });

      const { data } = h.meal.create.mock.calls[0][0];
      expect(data).toMatchObject({
        allergens: ['celery', 'mustard'],
        conditionalAllergens: [],
        allergensNone: false,
        addedAllergens: ['mustard'],
        customAllergens: [],
      });
      expect(data).not.toHaveProperty('lockVersion');
    });

    it('computes the diets and seasons of a recipe linked to the common list (§4.8)', async () => {
      const { meal, catalogIngredient, access, prisma } = harness();
      const id = '5b1f3c2e-8a44-4d0e-9f21-3c6a7e9b0d12';
      catalogIngredient.findMany.mockResolvedValue([
        {
          id,
          diets: ['vegan', 'vegetarian'],
          seasonMonths: [6, 7],
          allergens: [],
          allergensNone: true,
          aisle: 'fruits_legumes',
          isBasic: false,
          name: 'Tomate',
          status: 'active',
          chefProfileId: null,
          mergedIntoId: null,
        },
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
              unit: 'piece',
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
      // A ready dish, so `update` reaches `cutVersion`, which must decline: no change
      // is pending since the last version.
      const row = readyDishRow({ versionPending: false });
      expect(readiness(row).ready).toBe(true);
      stored(h, row);

      const view = await new DishesService(h.prisma, h.access).update(
        'clerk_1',
        'dish-1',
        { description: 'Plus de thym.' },
      );

      expect(h.meal.update).toHaveBeenCalledTimes(1);
      expect(h.meal.update.mock.calls[0][0].data).not.toHaveProperty('versionPending');
      expect(h.mealRecipeVersion.findUnique).not.toHaveBeenCalled();
      expect(h.mealRecipeVersion.create).not.toHaveBeenCalled();
      expect(view.recipeVersion).toBe(2);
      expect(view.readiness.ready).toBe(true);
    });

    it('keeps the pending changes in a version when the allergens are confirmed', async () => {
      const h = harness();
      // Not ready (a step has no type), but the ingredients just verified must be
      // the ones a booking cooks from.
      withEntries(h, READY_ENTRIES);
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
      withEntries(h, READY_ENTRIES);
      stored(h, readyDishRow({ allergensVerifiedAt: null, versionPending: true }));

      await new DishesService(h.prisma, h.access).confirmAllergens('clerk_1', 'dish-1');

      expect(h.meal.update.mock.calls[1][0].data).toEqual({ versionPending: false });
      expect(h.mealRecipeVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ version: 2 }),
      });
    });
  });

  describe('allergen verification (Recettes §4.9)', () => {
    it('confirms an unchanged stamped dish in one call, guarded by the lockVersion read', async () => {
      const h = harness();
      withEntries(h, READY_ENTRIES);
      h.meal.findUnique.mockResolvedValue(readyDishRow({ allergensVerifiedAt: null }));

      const view = await new DishesService(h.prisma, h.access).confirmAllergens(
        'clerk_1',
        'dish-1',
      );

      // No body, still guarded (race B); the lock version does not move.
      expect(h.meal.update).toHaveBeenCalledTimes(1);
      expect(h.meal.update).toHaveBeenCalledWith({
        where: { id: 'dish-1', chefProfileId: CHEF.id, lockVersion: 0 },
        data: { allergensVerifiedAt: expect.any(Date) },
      });
      expect(view.allergensVerifiedAt).toBeInstanceOf(Date);
    });

    it('confirms in one call a dish saved with blank optional line fields (no spurious 409)', async () => {
      const h = harness();
      withEntries(h, READY_ENTRIES);
      const service = new DishesService(h.prisma, h.access);
      await service.update('clerk_1', 'dish-1', {
        recipe: {
          ...READY_RECIPE,
          ingredients: READY_RECIPE.ingredients.map((line) => ({
            ...line,
            precision: '',
            preparation: ' ',
            group: '',
            rawText: '',
          })),
        },
      });
      const saved = h.meal.update.mock.calls[0][0].data;
      // The same rule as `readLines`: blank means nothing, stored as null.
      expect(saved.ingredients).toEqual([
        expect.objectContaining({
          precision: null,
          preparation: null,
          group: null,
          rawText: null,
        }),
        expect.objectContaining({ precision: null }),
      ]);

      h.meal.update.mockClear();
      h.meal.findUnique.mockResolvedValue(
        readyDishRow({ ...saved, lockVersion: 1, allergensVerifiedAt: null }),
      );
      await service.confirmAllergens('clerk_1', 'dish-1', 1);

      expect(h.meal.update).toHaveBeenCalledTimes(1);
      expect(h.meal.update.mock.calls[0][0].data).toEqual({
        allergensVerifiedAt: expect.any(Date),
      });
    });

    it('refuses a confirmation sent with an outdated lockVersion with 409, writing nothing (R8)', async () => {
      const { meal, access, prisma } = harness();
      meal.findUnique.mockResolvedValue(
        readyDishRow({ lockVersion: 5, allergensVerifiedAt: null }),
      );

      const error = await new DishesService(prisma, access)
        .confirmAllergens('clerk_1', 'dish-1', 4)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect(codeOf(error)).toMatchObject({ code: 'RECIPE_CONFLICT', lockVersion: 5 });
      expect(meal.update).not.toHaveBeenCalled();
    });

    it('confirms on the lockVersion sent, the write guarded by it and not moving it (R8)', async () => {
      const h = harness();
      withEntries(h, READY_ENTRIES);
      h.meal.findUnique.mockResolvedValue(
        readyDishRow({ lockVersion: 5, allergensVerifiedAt: null }),
      );

      await new DishesService(h.prisma, h.access).confirmAllergens(
        'clerk_1',
        'dish-1',
        5,
      );

      expect(h.meal.update).toHaveBeenCalledWith({
        where: { id: 'dish-1', chefProfileId: CHEF.id, lockVersion: 5 },
        data: { allergensVerifiedAt: expect.any(Date) },
      });
    });

    it.each([
      ['sent with its lockVersion', 5],
      ['sent without a body', undefined],
    ])(
      'answers 409 when an update lands between the read and the write (%s)',
      async (_case, sent) => {
        const h = harness();
        withEntries(h, READY_ENTRIES);
        h.meal.findUnique
          .mockResolvedValueOnce(
            readyDishRow({ lockVersion: 5, allergensVerifiedAt: null }),
          )
          .mockResolvedValueOnce(
            readyDishRow({ lockVersion: 6, allergensVerifiedAt: null }),
          );
        h.meal.update.mockRejectedValueOnce(noRowMatched());

        const error = await new DishesService(h.prisma, h.access)
          .confirmAllergens('clerk_1', 'dish-1', sent)
          .catch((e: unknown) => e);

        expect(codeOf(error)).toMatchObject({ code: 'RECIPE_CONFLICT', lockVersion: 6 });
        expect(h.mealRecipeVersion.create).not.toHaveBeenCalled();
      },
    );

    it('stamps an adopted copy first and asks to confirm again, then confirms it (R10)', async () => {
      const h = harness();
      withEntries(h, READY_ENTRIES);
      // Lines as an unstamped Lab's Food suggestion stores them: no `allergens`.
      stored(
        h,
        readyDishRow({
          allergensVerifiedAt: null,
          versionPending: false,
          ingredients: [
            {
              name: 'Ail',
              qty: 4,
              unit: 'clove',
              aisle: 'fruits-legumes',
              catalogIngredientId: 'cat-ail',
            },
            {
              name: 'Céleri-rave',
              qty: 300,
              unit: 'g',
              aisle: 'fruits-legumes',
              catalogIngredientId: 'cat-celeri',
            },
          ],
        }),
      );
      const service = new DishesService(h.prisma, h.access);

      const error = await service
        .confirmAllergens('clerk_1', 'dish-1', 0)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect(codeOf(error)).toMatchObject({ code: 'RECIPE_CONFLICT', lockVersion: 1 });
      const first = h.meal.update.mock.calls[0][0];
      expect(first.where).toEqual({
        id: 'dish-1',
        chefProfileId: CHEF.id,
        lockVersion: 0,
      });
      expect(first.data).toMatchObject({
        ingredients: [
          expect.objectContaining({ catalogIngredientId: 'cat-ail', allergens: [] }),
          expect.objectContaining({
            catalogIngredientId: 'cat-celeri',
            allergens: ['celery'],
            incomplete: false,
          }),
        ],
        allergens: ['celery'],
        // R7: the suggestion's hand-declared celery is kept, as added.
        addedAllergens: ['celery'],
        lockVersion: { increment: 1 },
        allergensVerifiedAt: null,
        versionPending: true,
      });
      expect(h.mealRecipeVersion.create).not.toHaveBeenCalled();

      // The chef reloads and confirms what is now computed.
      const view = await service.confirmAllergens('clerk_1', 'dish-1', 1);

      expect(view.allergensVerifiedAt).toBeInstanceOf(Date);
      expect(h.meal.update.mock.calls[1][0]).toEqual({
        where: { id: 'dish-1', chefProfileId: CHEF.id, lockVersion: 1 },
        data: { allergensVerifiedAt: expect.any(Date) },
      });
      // The stamped lines became the version a booking cooks from.
      expect(h.mealRecipeVersion.create).toHaveBeenCalledTimes(1);
    });

    it('never reads a line without stamped allergens as "none" (R10)', async () => {
      const h = harness();
      withEntries(h, READY_ENTRIES);
      // The columns already say what the garlic gives; only the line lacks its stamp.
      stored(
        h,
        readyDishRow({
          allergensVerifiedAt: null,
          ingredients: [
            {
              name: 'Ail',
              qty: 4,
              unit: 'clove',
              aisle: 'fruits-legumes',
              catalogIngredientId: 'cat-ail',
            },
          ],
          allergens: [],
          allergensNone: true,
        }),
      );

      const error = await new DishesService(h.prisma, h.access)
        .confirmAllergens('clerk_1', 'dish-1')
        .catch((e: unknown) => e);

      expect(codeOf(error)).toMatchObject({ code: 'RECIPE_CONFLICT', lockVersion: 1 });
      expect(h.meal.update.mock.calls[0][0].data.ingredients).toEqual([
        expect.objectContaining({ allergens: [], incomplete: false }),
      ]);
    });

    it('recomputes from the common list as it is now, not from the stamps stored (R10)', async () => {
      const h = harness();
      // The list now says the celeriac also brings mustard; the stamps still say celery.
      withEntries(h, [
        READY_ENTRIES[0],
        { ...READY_ENTRIES[1], allergens: ['celery', 'mustard'] },
      ]);
      stored(h, readyDishRow({ allergensVerifiedAt: new Date('2026-10-01') }));

      const error = await new DishesService(h.prisma, h.access)
        .confirmAllergens('clerk_1', 'dish-1')
        .catch((e: unknown) => e);

      expect(codeOf(error)).toMatchObject({ code: 'RECIPE_CONFLICT', lockVersion: 1 });
      expect(h.meal.update.mock.calls[0][0].data).toMatchObject({
        allergens: ['celery', 'mustard'],
        allergensVerifiedAt: null,
      });
    });

    it('refuses to confirm a recipe without ingredients, with 422 VALIDATION_FAILED', async () => {
      const { meal, access, prisma } = harness();
      meal.findUnique.mockResolvedValue(dishRow({ ingredients: [] }));

      const error = await new DishesService(prisma, access)
        .confirmAllergens('clerk_1', 'dish-1')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(codeOf(error).code).toBe('VALIDATION_FAILED');
      expect(meal.update).not.toHaveBeenCalled();
    });

    it('refuses to confirm while a line is not linked, with 422 INGREDIENT_NOT_LINKED', async () => {
      const h = harness();
      withEntries(h, READY_ENTRIES);
      const [ail] = readyDishRow().ingredients;
      h.meal.findUnique.mockResolvedValue(
        readyDishRow({
          ingredients: [ail, stampedLine({ name: 'Sel', qty: 1, unit: 'pinch' })],
        }),
      );

      const error = await new DishesService(h.prisma, h.access)
        .confirmAllergens('clerk_1', 'dish-1')
        .catch((e: unknown) => e);

      expect(codeOf(error)).toMatchObject({ code: 'INGREDIENT_NOT_LINKED', lines: [1] });
      expect(h.meal.update).not.toHaveBeenCalled();
    });

    it('refuses to confirm a line whose ingredient is now to complete, whatever its stamp says', async () => {
      const h = harness();
      // The stored stamp says complete; the list says the garlic lacks its aisle now.
      withEntries(h, [{ ...READY_ENTRIES[0], aisle: null }, READY_ENTRIES[1]]);
      h.meal.findUnique.mockResolvedValue(readyDishRow());

      const error = await new DishesService(h.prisma, h.access)
        .confirmAllergens('clerk_1', 'dish-1')
        .catch((e: unknown) => e);

      expect(codeOf(error)).toMatchObject({ code: 'INGREDIENT_NOT_LINKED', lines: [0] });
      expect(h.meal.update).not.toHaveBeenCalled();
    });

    it('refuses to confirm an allergen code outside the 14 (ruling R5)', async () => {
      const h = harness();
      withEntries(h, [{ ...READY_ENTRIES[0], allergens: ['egg'] }, READY_ENTRIES[1]]);
      h.meal.findUnique.mockResolvedValue(readyDishRow());

      const error = await new DishesService(h.prisma, h.access)
        .confirmAllergens('clerk_1', 'dish-1')
        .catch((e: unknown) => e);

      expect(codeOf(error)).toMatchObject({
        code: 'VALIDATION_FAILED',
        allergens: ['egg'],
      });
      expect(h.meal.update).not.toHaveBeenCalled();
    });

    it('is cleared by an update that read no verification, if a confirmation landed meanwhile (race A)', async () => {
      const h = harness();
      withEntries(h, [...READY_ENTRIES, entryRow({ id: 'cat-thym', name: 'Thym' })]);
      // Read before the other tab confirmed: not verified yet, same lockVersion.
      h.meal.findUnique.mockResolvedValue(readyDishRow({ allergensVerifiedAt: null }));

      await new DishesService(h.prisma, h.access).update('clerk_1', 'dish-1', {
        recipe: {
          ...READY_RECIPE,
          ingredients: [
            ...READY_RECIPE.ingredients,
            { name: 'Thym', qty: 2, unit: 'bunch', catalogIngredientId: 'cat-thym' },
          ],
        },
      });

      expect(h.meal.update.mock.calls[0][0].data).toHaveProperty(
        'allergensVerifiedAt',
        null,
      );
    });

    it('clears it when an ingredient changes, not when a quantity does', async () => {
      const { meal, access, prisma } = harness();
      const ail = { name: 'Ail', qty: 4, unit: 'clove', aisle: 'fruits-legumes' };
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
        where: { id: 'dish-1', chefProfileId: CHEF.id, lockVersion: 0 },
        data: { description: 'Plus de thym.', lockVersion: { increment: 1 } },
      });
    });

    it('refuses an edit that would leave a published dish unpublishable', async () => {
      const { meal, access, prisma } = harness();
      meal.findUnique.mockResolvedValue(dishRow({ status: MealStatus.published }));
      const service = new DishesService(prisma, access);

      for (const edit of [{ name: ' ' }, { portions: 0 }]) {
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
  });

  describe('two saves of the same recipe (Recettes §8.1, lockVersion)', () => {
    it('refuses a stale lockVersion with 409 RECIPE_CONFLICT and writes nothing (Review Focus 1)', async () => {
      const h = harness();
      h.meal.findUnique.mockResolvedValue(dishRow({ lockVersion: 4 }));

      const error = await new DishesService(h.prisma, h.access)
        .update('clerk_1', 'dish-1', { lockVersion: 3, description: 'Plus de thym.' })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect(codeOf(error)).toMatchObject({ code: 'RECIPE_CONFLICT', lockVersion: 4 });
      expect(h.meal.update).not.toHaveBeenCalled();
    });

    it('saves over the version the screen read, and moves it on', async () => {
      const h = harness();
      h.meal.findUnique.mockResolvedValue(dishRow({ lockVersion: 4 }));

      await new DishesService(h.prisma, h.access).update('clerk_1', 'dish-1', {
        lockVersion: 4,
        description: 'Plus de thym.',
      });

      expect(h.meal.update.mock.calls[0][0]).toMatchObject({
        where: { id: 'dish-1', chefProfileId: CHEF.id, lockVersion: 4 },
        data: { lockVersion: { increment: 1 } },
      });
    });

    it('answers 409 with the version read again when another save won the race, and makes no version', async () => {
      const h = harness();
      withEntries(h, READY_ENTRIES);
      h.meal.findUnique
        .mockResolvedValueOnce(readyDishRow({ lockVersion: 4 }))
        .mockResolvedValueOnce(readyDishRow({ lockVersion: 5 }));
      h.meal.update.mockRejectedValueOnce(noRowMatched());

      const error = await new DishesService(h.prisma, h.access)
        .update('clerk_1', 'dish-1', { portions: 6 })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect(codeOf(error)).toMatchObject({ code: 'RECIPE_CONFLICT', lockVersion: 5 });
      expect(h.meal.update).toHaveBeenCalledTimes(1);
      expect(h.mealRecipeVersion.create).not.toHaveBeenCalled();
    });

    it('answers 404 when the dish was deleted between the read and the write', async () => {
      const h = harness();
      h.meal.findUnique.mockResolvedValueOnce(dishRow()).mockResolvedValueOnce(null);
      h.meal.update.mockRejectedValueOnce(noRowMatched());

      await expect(
        new DishesService(h.prisma, h.access).update('clerk_1', 'dish-1', {
          portions: 6,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses a screen opened before the common list changed the dish (Review Focus 2)', async () => {
      const h = harness();
      withEntries(h, READY_ENTRIES);
      // The §7.3 propagation moved the dish on: allergens recomputed, verification gone.
      h.meal.findUnique.mockResolvedValue(
        readyDishRow({
          lockVersion: 5,
          allergens: ['milk', 'celery'],
          allergensVerifiedAt: null,
        }),
      );

      const error = await new DishesService(h.prisma, h.access)
        .update('clerk_1', 'dish-1', { lockVersion: 4, recipe: READY_RECIPE })
        .catch((e: unknown) => e);

      expect(codeOf(error)).toMatchObject({ code: 'RECIPE_CONFLICT', lockVersion: 5 });
      expect(h.meal.update).not.toHaveBeenCalled();
      expect(h.mealRecipeVersion.create).not.toHaveBeenCalled();
    });
  });

  describe('saving a recipe (Recettes §5.2, §6.1)', () => {
    const FARINE = entryRow({
      id: 'cat-farine',
      name: 'Farine de blé',
      aisle: 'epicerie-sucree',
      allergens: ['gluten'],
      allergensNone: false,
      diets: ['vegan', 'vegetarian'],
      seasonMonths: [],
    });
    const LAIT = entryRow({
      id: 'cat-lait',
      name: 'Lait entier',
      aisle: 'cremerie',
      allergens: ['milk'],
      allergensNone: false,
      diets: ['vegetarian'],
      seasonMonths: [],
    });

    it('writes the stamped lines, the computed allergens and the classification under the lock', async () => {
      const h = harness();
      withEntries(h, [FARINE, LAIT]);
      h.meal.findUnique.mockResolvedValue(
        dishRow({ lockVersion: 2, addedAllergens: [], allergens: [] }),
      );

      await new DishesService(h.prisma, h.access).update('clerk_1', 'dish-1', {
        recipe: {
          ingredients: [
            { name: 'farine', qty: 250, unit: 'g', catalogIngredientId: 'cat-farine' },
            {
              name: 'lait',
              qty: 20,
              unit: 'cl',
              catalogIngredientId: 'cat-lait',
              optional: true,
            },
          ],
          steps: [],
        },
      });

      const { where, data } = h.meal.update.mock.calls[0][0];
      expect(where).toEqual({ id: 'dish-1', chefProfileId: CHEF.id, lockVersion: 2 });
      expect(data).toMatchObject({
        ingredients: [
          expect.objectContaining({
            name: 'Farine de blé',
            aisle: 'epicerie-sucree',
            allergens: ['gluten'],
            incomplete: false,
          }),
          expect.objectContaining({
            name: 'Lait entier',
            aisle: 'cremerie',
            allergens: ['milk'],
            optional: true,
          }),
        ],
        allergens: ['gluten', 'milk'],
        // Only the optional milk brings milk: shown "if used", still checked (§6.1).
        conditionalAllergens: ['milk'],
        allergensNone: false,
        classification: {
          diets: ['vegetarian'],
          seasonMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        },
        addedAllergens: [],
        customAllergens: [],
        lockVersion: { increment: 1 },
      });
    });

    it('says "none of the 14" only when every line is known and brings none', async () => {
      const h = harness();
      withEntries(h, READY_ENTRIES);
      h.meal.findUnique.mockResolvedValue(dishRow({ addedAllergens: [], allergens: [] }));
      const service = new DishesService(h.prisma, h.access);
      const ail = { name: 'Ail', qty: 4, unit: 'clove', catalogIngredientId: 'cat-ail' };

      await service.update('clerk_1', 'dish-1', {
        recipe: { ingredients: [ail], steps: [] },
      });
      await service.update('clerk_1', 'dish-1', {
        recipe: { ingredients: [ail, { name: 'Sel', qty: 1, unit: 'pinch' }], steps: [] },
      });

      expect(h.meal.update.mock.calls[0][0].data).toMatchObject({
        allergens: [],
        allergensNone: true,
      });
      // An unlinked line is unknown, never "no allergen".
      expect(h.meal.update.mock.calls[1][0].data).toMatchObject({
        allergens: [],
        allergensNone: false,
        classification: Prisma.DbNull,
      });
    });

    it('keeps the chef’s own quantity, unit, precision, option and group on a linked line', async () => {
      const h = harness();
      withEntries(h, [
        entryRow({
          id: 'cat-moutarde',
          name: 'Moutarde de Dijon',
          aisle: 'epicerie-salee',
          allergens: ['mustard'],
          allergensNone: false,
        }),
      ]);

      await new DishesService(h.prisma, h.access).update('clerk_1', 'dish-1', {
        recipe: {
          ingredients: [
            {
              name: 'moutarde',
              qty: 1.5,
              unit: 'tbsp',
              aisle: 'mon-rayon',
              precision: 'à l’ancienne',
              optional: true,
              group: 'Sauce',
              catalogIngredientId: 'cat-moutarde',
            },
          ],
          steps: [],
        },
      });

      expect(h.meal.update.mock.calls[0][0].data.ingredients).toEqual([
        expect.objectContaining({
          qty: 1.5,
          unit: 'tbsp',
          precision: 'à l’ancienne',
          optional: true,
          group: 'Sauce',
          name: 'Moutarde de Dijon',
          aisle: 'epicerie-salee',
          allergens: ['mustard'],
        }),
      ]);
    });

    it('adds the chef’s gluten to a gluten-free recipe and drops the gluten-free diet', async () => {
      const h = harness();
      const riz = entryRow({
        id: 'cat-riz',
        name: 'Riz',
        aisle: 'epicerie-salee',
        diets: ['gluten-free', 'vegan', 'vegetarian'],
        seasonMonths: [],
      });
      withEntries(h, [riz]);
      h.meal.findUnique.mockResolvedValue(
        dishRow({
          addedAllergens: [],
          allergens: [],
          allergensNone: true,
          ingredients: [
            {
              name: 'Riz',
              qty: 200,
              unit: 'g',
              aisle: 'epicerie-salee',
              catalogIngredientId: 'cat-riz',
              allergens: [],
              incomplete: false,
            },
          ],
        }),
      );

      // Sent alone, the chef's allergens are applied to the lines as stored.
      await new DishesService(h.prisma, h.access).update('clerk_1', 'dish-1', {
        addedAllergens: ['gluten'],
      });

      const { data } = h.meal.update.mock.calls[0][0];
      expect(data.allergens).toEqual(['gluten']);
      expect(data.allergensNone).toBe(false);
      expect(data.addedAllergens).toEqual(['gluten']);
      expect(data.ingredients).toEqual([
        expect.objectContaining({ name: 'Riz', catalogIngredientId: 'cat-riz' }),
      ]);
      expect(data.classification).toEqual({
        diets: ['vegan', 'vegetarian'],
        seasonMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      });
    });

    it('refuses two lines of the same ingredient with 422 DUPLICATE_INGREDIENT_LINE', async () => {
      const h = harness();
      withEntries(h, READY_ENTRIES);
      const ail = { name: 'Ail', qty: 4, unit: 'clove', catalogIngredientId: 'cat-ail' };

      const error = await new DishesService(h.prisma, h.access)
        .update('clerk_1', 'dish-1', {
          recipe: { ingredients: [ail, { ...ail, qty: 2 }], steps: [] },
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(codeOf(error)).toMatchObject({
        code: 'DUPLICATE_INGREDIENT_LINE',
        lines: [[0, 1]],
      });
      expect(h.meal.update).not.toHaveBeenCalled();
    });

    it('refuses a line without a quantity in grams with 422 VALIDATION_FAILED', async () => {
      const h = harness();

      const error = await new DishesService(h.prisma, h.access)
        .update('clerk_1', 'dish-1', {
          recipe: { ingredients: [{ name: 'Farine', qty: null, unit: 'g' }], steps: [] },
        })
        .catch((e: unknown) => e);

      expect(codeOf(error)).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [expect.objectContaining({ field: 'recipe.ingredients[0].qty' })],
      });
      expect(h.meal.update).not.toHaveBeenCalled();
    });

    it('keeps an inactive entry the dish already had, refuses a newly chosen one', async () => {
      const h = harness();
      withEntries(h, [
        entryRow({ id: 'cat-old', name: 'Ancien', status: 'inactive' }),
        entryRow({ id: 'cat-gone', name: 'Retiré', status: 'inactive' }),
      ]);
      const old = {
        name: 'Ancien',
        qty: 1,
        unit: 'piece',
        catalogIngredientId: 'cat-old',
      };
      h.meal.findUnique.mockResolvedValue(
        dishRow({ ingredients: [{ ...old, allergens: [], incomplete: false }] }),
      );
      const service = new DishesService(h.prisma, h.access);

      await service.update('clerk_1', 'dish-1', {
        recipe: { ingredients: [{ ...old, qty: 2 }], steps: [] },
      });
      const error = await service
        .update('clerk_1', 'dish-1', {
          recipe: {
            ingredients: [
              old,
              { ...old, name: 'Retiré', catalogIngredientId: 'cat-gone' },
            ],
            steps: [],
          },
        })
        .catch((e: unknown) => e);

      expect(h.meal.update).toHaveBeenCalledTimes(1);
      expect(codeOf(error)).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [expect.objectContaining({ field: 'recipe.ingredients[1]' })],
      });
    });

    it('keeps a published dish published when its recipe becomes incomplete, with no new version', async () => {
      const h = harness();
      withEntries(h, READY_ENTRIES);
      stored(h, readyDishRow({ status: MealStatus.published }));

      const view = await new DishesService(h.prisma, h.access).update(
        'clerk_1',
        'dish-1',
        {
          recipe: {
            ...READY_RECIPE,
            ingredients: [
              ...READY_RECIPE.ingredients,
              { name: 'Sel', qty: 1, unit: 'pinch' },
            ],
          },
        },
      );

      const { data } = h.meal.update.mock.calls[0][0];
      expect(data).not.toHaveProperty('status');
      expect(data).toMatchObject({ versionPending: true, allergensVerifiedAt: null });
      expect(h.meal.update).toHaveBeenCalledTimes(1);
      expect(h.mealRecipeVersion.create).not.toHaveBeenCalled();
      expect(view.status).toBe(MealStatus.published);
    });
  });

  describe('re-verification of the allergens (Recettes §6.5)', () => {
    const THYM = entryRow({ id: 'cat-thym', name: 'Thym' });

    it('clears it when a line is added', async () => {
      const h = harness();
      withEntries(h, [...READY_ENTRIES, THYM]);
      stored(h, readyDishRow());

      await new DishesService(h.prisma, h.access).update('clerk_1', 'dish-1', {
        recipe: {
          ...READY_RECIPE,
          ingredients: [
            ...READY_RECIPE.ingredients,
            { name: 'Thym', qty: 2, unit: 'bunch', catalogIngredientId: 'cat-thym' },
          ],
        },
      });

      expect(h.meal.update.mock.calls[0][0].data.allergensVerifiedAt).toBeNull();
    });

    it('clears it when the chef adds an allergen', async () => {
      const h = harness();
      withEntries(h, READY_ENTRIES);
      stored(h, readyDishRow());

      await new DishesService(h.prisma, h.access).update('clerk_1', 'dish-1', {
        addedAllergens: ['mustard'],
      });

      const { data } = h.meal.update.mock.calls[0][0];
      expect(data.allergensVerifiedAt).toBeNull();
      expect(data.allergens).toEqual(['celery', 'mustard']);
    });

    it('keeps it when only a quantity changes', async () => {
      const h = harness();
      withEntries(h, READY_ENTRIES);
      stored(h, readyDishRow());
      const [ail, celeri] = READY_RECIPE.ingredients;

      await new DishesService(h.prisma, h.access).update('clerk_1', 'dish-1', {
        recipe: { ...READY_RECIPE, ingredients: [{ ...ail, qty: 6 }, celeri] },
      });

      const { data } = h.meal.update.mock.calls[0][0];
      expect(data).not.toHaveProperty('allergensVerifiedAt');
      expect(data.versionPending).toBe(true);
    });

    it('keeps it, with nothing pending, when the stored recipe is sent back as it is', async () => {
      const h = harness();
      withEntries(h, READY_ENTRIES);
      stored(h, readyDishRow());

      await new DishesService(h.prisma, h.access).update('clerk_1', 'dish-1', {
        lockVersion: 0,
        recipe: READY_RECIPE,
      });

      const { data } = h.meal.update.mock.calls[0][0];
      expect(data).not.toHaveProperty('allergensVerifiedAt');
      expect(data).not.toHaveProperty('versionPending');
      expect(data).not.toHaveProperty('reviewReason');
      expect(h.mealRecipeVersion.create).not.toHaveBeenCalled();
    });
  });

  describe('moderation of a recipe change (§3.2)', () => {
    const published = () =>
      readyDishRow({ status: MealStatus.published, reviewedAt: new Date('2026-09-20') });

    it('sends a reviewed dish back to the queue when its computed allergens change', async () => {
      const h = harness();
      withEntries(h, [
        ...READY_ENTRIES,
        entryRow({
          id: 'cat-beurre',
          name: 'Beurre',
          aisle: 'cremerie',
          allergens: ['milk'],
          allergensNone: false,
        }),
      ]);
      stored(h, published());

      await new DishesService(h.prisma, h.access).update('clerk_1', 'dish-1', {
        recipe: {
          ...READY_RECIPE,
          ingredients: [
            ...READY_RECIPE.ingredients,
            { name: 'Beurre', qty: 30, unit: 'g', catalogIngredientId: 'cat-beurre' },
          ],
        },
      });

      expect(h.meal.update.mock.calls[0][0].data).toMatchObject({
        // In the order of the annex.
        allergens: ['milk', 'celery'],
        sourceChangedAt: null,
        reviewReason: 'edited-after-review',
      });
    });

    it('does the same for a change of country', async () => {
      const h = harness();
      stored(h, published());

      await new DishesService(h.prisma, h.access).update('clerk_1', 'dish-1', {
        country: 'SN',
      });

      expect(h.meal.update.mock.calls[0][0].data.reviewReason).toBe(
        'edited-after-review',
      );
    });

    it('leaves the queue alone when the allergens stay the same', async () => {
      const h = harness();
      withEntries(h, READY_ENTRIES);
      stored(h, published());
      const [ail, celeri] = READY_RECIPE.ingredients;

      await new DishesService(h.prisma, h.access).update('clerk_1', 'dish-1', {
        recipe: { ...READY_RECIPE, ingredients: [{ ...ail, qty: 6 }, celeri] },
      });

      const { data } = h.meal.update.mock.calls[0][0];
      expect(data).not.toHaveProperty('reviewReason');
      expect(data).not.toHaveProperty('sourceChangedAt');
    });
  });

  describe('hand-declared allergens are never lost (ruling R7)', () => {
    const BEURRE = entryRow({
      id: 'cat-beurre',
      name: 'Beurre',
      aisle: 'cremerie',
      allergens: ['milk'],
      allergensNone: false,
    });
    /** Declared by hand before the socle: listed, but no line or addition explains it. */
    const legacy = (overrides: Record<string, unknown> = {}) =>
      dishRow({
        allergens: ['milk'],
        addedAllergens: [],
        ingredients: [{ name: 'Beurre', qty: 30, unit: 'g', aisle: 'cremerie' }],
        ...overrides,
      });

    it('carries a legacy declared allergen into addedAllergens on a save', async () => {
      const h = harness();
      h.meal.findUnique.mockResolvedValue(legacy());

      await new DishesService(h.prisma, h.access).update('clerk_1', 'dish-1', {
        recipe: {
          ingredients: [
            { name: 'Beurre', qty: 40, unit: 'g' },
            { name: 'Farine', qty: 200, unit: 'g' },
          ],
          steps: [],
        },
      });

      const { data } = h.meal.update.mock.calls[0][0];
      expect(data.allergens).toContain('milk');
      expect(data.addedAllergens).toEqual(['milk']);
    });

    it('keeps the verification and the queue of a legacy dish saved unchanged', async () => {
      const h = harness();
      h.meal.findUnique.mockResolvedValue(
        legacy({
          allergensVerifiedAt: new Date('2026-10-01'),
          status: MealStatus.published,
          reviewedAt: new Date('2026-10-02'),
        }),
      );

      await new DishesService(h.prisma, h.access).update('clerk_1', 'dish-1', {
        recipe: { ingredients: [{ name: 'Beurre', qty: 30, unit: 'g' }], steps: [] },
      });

      const { data } = h.meal.update.mock.calls[0][0];
      expect(data).toMatchObject({ allergens: ['milk'], addedAllergens: ['milk'] });
      // Moving "declared" to "added" is what the reprise does (§9): nothing new to verify.
      expect(data).not.toHaveProperty('allergensVerifiedAt');
      expect(data).not.toHaveProperty('reviewReason');
    });

    it('unions the legacy ones with the allergens the chef sends, in annex order', async () => {
      const h = harness();
      h.meal.findUnique.mockResolvedValue(
        legacy({ allergens: ['milk', 'celery'], addedAllergens: ['celery'] }),
      );

      await new DishesService(h.prisma, h.access).update('clerk_1', 'dish-1', {
        addedAllergens: ['mustard'],
      });

      const { data } = h.meal.update.mock.calls[0][0];
      // celery was the chef's own: sending without it removes it.
      expect(data.addedAllergens).toEqual(['milk', 'mustard']);
      expect(data.allergens).toEqual(['milk', 'mustard']);
    });

    it('drops milk with the butter line once it was computed (not carried)', async () => {
      const h = harness();
      withEntries(h, [...READY_ENTRIES, BEURRE]);
      const [ail] = readyDishRow().ingredients;
      h.meal.findUnique.mockResolvedValue(
        dishRow({
          allergens: ['milk'],
          addedAllergens: [],
          ingredients: [
            ail,
            {
              name: 'Beurre',
              qty: 30,
              unit: 'g',
              aisle: 'cremerie',
              catalogIngredientId: 'cat-beurre',
              allergens: ['milk'],
              incomplete: false,
            },
          ],
        }),
      );

      await new DishesService(h.prisma, h.access).update('clerk_1', 'dish-1', {
        recipe: {
          ingredients: [
            { name: 'Ail', qty: 4, unit: 'clove', catalogIngredientId: 'cat-ail' },
          ],
          steps: [],
        },
      });

      const { data } = h.meal.update.mock.calls[0][0];
      expect(data.allergens).toEqual([]);
      expect(data.addedAllergens).toEqual([]);
    });

    it('lets the chef remove an allergen they added', async () => {
      const h = harness();
      h.meal.findUnique.mockResolvedValue(
        dishRow({ allergens: ['milk'], addedAllergens: ['milk'] }),
      );

      await new DishesService(h.prisma, h.access).update('clerk_1', 'dish-1', {
        addedAllergens: [],
      });

      const { data } = h.meal.update.mock.calls[0][0];
      expect(data.allergens).toEqual([]);
      expect(data.addedAllergens).toEqual([]);
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
        readyDishRow({ description: null, imageUrl: null }),
      );

      const error = await new DishesService(prisma, access)
        .publish('clerk_1', 'dish-1')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(codeOf(error)).toMatchObject({
        code: 'RECIPE_NOT_READY',
        problems: [
          expect.objectContaining({ field: 'description' }),
          expect.objectContaining({ code: 'PHOTO_MISSING', field: 'imageUrl' }),
        ],
      });
      expect(meal.update).not.toHaveBeenCalled();
    });

    it('refuses to publish without a photo: PHOTO_MISSING is now a point to publish', async () => {
      const { meal, access, prisma } = harness();
      meal.findUnique.mockResolvedValue(readyDishRow({ imageUrl: null }));

      const error = await new DishesService(prisma, access)
        .publish('clerk_1', 'dish-1')
        .catch((e: unknown) => e);

      expect(codeOf(error)).toMatchObject({
        code: 'RECIPE_NOT_READY',
        problems: [expect.objectContaining({ code: 'PHOTO_MISSING' })],
      });
      expect(meal.update).not.toHaveBeenCalled();
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
        addedAllergens: ['celery', 'milk'],
      });

      expect(meal.update.mock.calls[0][0].data.reviewReason).toBe('edited-after-review');
    });

    it('sends a reviewed dish back to the queue when its allergens change', async () => {
      const { meal, access, prisma } = harness();
      meal.findUnique.mockResolvedValue(
        dishRow({ status: MealStatus.published, reviewedAt: new Date('2026-09-20') }),
      );

      await new DishesService(prisma, access).update('clerk_1', 'dish-1', {
        addedAllergens: ['celery', 'milk'],
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
