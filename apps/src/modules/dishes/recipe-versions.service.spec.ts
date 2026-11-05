import { NotFoundException } from '@nestjs/common';

import {
  CHEF,
  dishRow,
  entryRow,
  harness,
  readyDishRow,
  withEntries,
} from './dishes.test-helpers';
import { DishesService } from './dishes.service';
import { RecipeVersionsService } from './recipe-versions.service';

const version = (overrides: Record<string, unknown> = {}) => ({
  id: 'v-1',
  mealId: 'dish-1',
  version: 1,
  portions: 4,
  ingredients: [],
  steps: [{ order: 1, text: 'Enfourner.', type: 'cuisson', durationMinutes: 55 }],
  reheating: null,
  storage: null,
  createdAt: new Date('2026-10-01T08:00:00.000Z'),
  _count: { bookingMeals: 0 },
  ...overrides,
});

function wire(h: ReturnType<typeof harness>) {
  const dishes = new DishesService(h.prisma, h.access);
  return new RecipeVersionsService(h.prisma, h.access, dishes);
}

const savedData = (h: ReturnType<typeof harness>) =>
  h.meal.update.mock.calls[0][0].data as Record<string, unknown> & {
    ingredients: {
      catalogIngredientId: string | null;
      unit: string | null;
      toVerify: boolean;
    }[];
  };

describe('RecipeVersionsService (Recettes §8.2)', () => {
  describe('list', () => {
    it('lists newest first with the bookings pinning each version and the current one', async () => {
      const h = harness();
      h.meal.findUnique.mockResolvedValue(readyDishRow({ recipeVersion: 2 }));
      h.mealRecipeVersion.findMany.mockResolvedValue([
        version({ version: 2, _count: { bookingMeals: 3 } }),
        version({ version: 1 }),
      ]);

      const result = await wire(h).list('clerk_1', 'dish-1');

      expect(h.mealRecipeVersion.findMany.mock.calls[0][0]).toMatchObject({
        where: { mealId: 'dish-1' },
        orderBy: { version: 'desc' },
      });
      expect(result).toEqual([
        { version: 2, createdAt: expect.any(Date), bookings: 3, current: true },
        { version: 1, createdAt: expect.any(Date), bookings: 0, current: false },
      ]);
    });

    it("answers 404 for another chef's dish", async () => {
      const h = harness();
      h.meal.findUnique.mockResolvedValue(dishRow({ chefProfileId: 'chef-2' }));
      await expect(wire(h).list('clerk_1', 'dish-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(h.mealRecipeVersion.findMany).not.toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('returns one version', async () => {
      const h = harness();
      h.meal.findUnique.mockResolvedValue(readyDishRow());
      h.mealRecipeVersion.findUnique.mockResolvedValue(version());

      const result = await wire(h).get('clerk_1', 'dish-1', 1);

      expect(h.mealRecipeVersion.findUnique.mock.calls[0][0]).toMatchObject({
        where: { mealId_version: { mealId: 'dish-1', version: 1 } },
      });
      expect(result).toMatchObject({ version: 1, portions: 4 });
      expect(result).not.toHaveProperty('_count');
    });

    it("answers 404 on another chef's dish, and on an unknown version", async () => {
      const h = harness();
      h.meal.findUnique.mockResolvedValue(dishRow({ chefProfileId: 'chef-2' }));
      await expect(wire(h).get('clerk_1', 'dish-1', 1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(h.mealRecipeVersion.findUnique).not.toHaveBeenCalled();

      h.meal.findUnique.mockResolvedValue(readyDishRow());
      h.mealRecipeVersion.findUnique.mockResolvedValue(null);
      await expect(wire(h).get('clerk_1', 'dish-1', 9)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('restore', () => {
    it('saves the version through DishesService.update with its portions and recipe', async () => {
      const h = harness();
      h.meal.findUnique.mockResolvedValue(readyDishRow({ lockVersion: 5 }));
      h.mealRecipeVersion.findUnique.mockResolvedValue(
        version({
          ingredients: [{ name: 'Sel', qty: 1, unit: 'pinch' }],
          storage: { method: 'fridge', days: 2 },
          reheating: { modes: ['oven'], minutes: 10 },
        }),
      );
      const dishes = new DishesService(h.prisma, h.access);
      const update = jest.spyOn(dishes, 'update').mockResolvedValue({} as never);
      const service = new RecipeVersionsService(h.prisma, h.access, dishes);

      await service.restore('clerk_1', 'dish-1', 1, 5);

      expect(update).toHaveBeenCalledWith(
        'clerk_1',
        'dish-1',
        {
          portions: 4,
          lockVersion: 5,
          recipe: {
            ingredients: [expect.objectContaining({ name: 'Sel', unit: 'pinch' })],
            steps: [
              { order: 1, text: 'Enfourner.', type: 'cuisson', durationMinutes: 55 },
            ],
            storage: { method: 'fridge', days: 2 },
            reheating: { modes: ['oven'], minutes: 10 },
          },
        },
        { allowedIds: [] },
      );
    });

    it('answers 404 for a version of another chef or an unknown one, without saving', async () => {
      const h = harness();
      h.meal.findUnique.mockResolvedValue(dishRow({ chefProfileId: 'chef-2' }));
      await expect(wire(h).restore('clerk_1', 'dish-1', 1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      h.meal.findUnique.mockResolvedValue(readyDishRow());
      h.mealRecipeVersion.findUnique.mockResolvedValue(null);
      await expect(wire(h).restore('clerk_1', 'dish-1', 1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(h.meal.update).not.toHaveBeenCalled();
    });

    it('repoints a line linked to a merged entry to its target and recomputes the allergens (review focus 5)', async () => {
      const h = harness();
      withEntries(h, [
        entryRow({
          id: 'cat-old',
          name: 'Crème perso',
          status: 'merged',
          chefProfileId: CHEF.id,
          mergedIntoId: 'cat-new',
        }),
        entryRow({
          id: 'cat-new',
          name: 'Crème',
          allergens: ['milk'],
          allergensNone: false,
        }),
      ]);
      h.meal.findUnique.mockResolvedValue(dishRow());
      h.mealRecipeVersion.findUnique.mockResolvedValue(
        version({
          ingredients: [
            {
              name: 'Crème perso',
              qty: 20,
              unit: 'cl',
              catalogIngredientId: 'cat-old',
              allergens: [],
            },
          ],
        }),
      );

      await wire(h).restore('clerk_1', 'dish-1', 1);

      const data = savedData(h);
      expect(data.ingredients[0]).toMatchObject({
        catalogIngredientId: 'cat-new',
        name: 'Crème',
        allergens: ['milk'],
      });
      expect(data.allergens).toEqual(expect.arrayContaining(['milk']));
    });

    it('turns a line whose entry is gone into an unlinked line to verify, keeping the restore', async () => {
      const h = harness();
      withEntries(h, [
        entryRow({
          id: 'cat-dead',
          status: 'merged',
          chefProfileId: CHEF.id,
          mergedIntoId: null,
        }),
      ]);
      h.meal.findUnique.mockResolvedValue(dishRow());
      h.mealRecipeVersion.findUnique.mockResolvedValue(
        version({
          ingredients: [
            { name: 'Ail', qty: 2, unit: 'clove', catalogIngredientId: 'cat-dead' },
            { name: 'Sel', qty: 1, unit: 'pinch', catalogIngredientId: 'cat-unknown' },
          ],
        }),
      );

      await wire(h).restore('clerk_1', 'dish-1', 1);

      const lines = savedData(h).ingredients;
      expect(lines[0]).toMatchObject({
        catalogIngredientId: null,
        toVerify: true,
        rawText: '2 clove Ail',
      });
      expect(lines[1]).toMatchObject({ catalogIngredientId: null, toVerify: true });
    });

    it("keeps a common entry deactivated since the version, and still refuses another chef's private one", async () => {
      const h = harness();
      withEntries(h, [
        entryRow({ id: 'cat-off', name: 'Sarriette', status: 'inactive' }),
        entryRow({
          id: 'cat-theirs',
          name: 'Secret',
          status: 'active',
          chefProfileId: 'chef-2',
        }),
      ]);
      h.meal.findUnique.mockResolvedValue(dishRow());
      h.mealRecipeVersion.findUnique.mockResolvedValue(
        version({
          ingredients: [
            { name: 'Sarriette', qty: 1, unit: 'g', catalogIngredientId: 'cat-off' },
          ],
        }),
      );

      await wire(h).restore('clerk_1', 'dish-1', 1);
      expect(savedData(h).ingredients[0]).toMatchObject({
        catalogIngredientId: 'cat-off',
      });

      h.meal.update.mockClear();
      h.mealRecipeVersion.findUnique.mockResolvedValue(
        version({
          ingredients: [
            { name: 'Secret', qty: 1, unit: 'g', catalogIngredientId: 'cat-theirs' },
          ],
        }),
      );
      await expect(wire(h).restore('clerk_1', 'dish-1', 1)).rejects.toMatchObject({
        status: 422,
      });
      expect(h.meal.update).not.toHaveBeenCalled();
    });

    it('restores an old free-text unit "gousse" as clove', async () => {
      const h = harness();
      h.meal.findUnique.mockResolvedValue(dishRow());
      h.mealRecipeVersion.findUnique.mockResolvedValue(
        version({ ingredients: [{ name: 'Ail', qty: 3, unit: 'gousse' }] }),
      );

      await wire(h).restore('clerk_1', 'dish-1', 1);

      expect(savedData(h).ingredients[0]).toMatchObject({
        unit: 'clove',
        toVerify: false,
      });
    });
  });
});
