import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import {
  MealContinent,
  MealDifficulty,
  MealStatus,
  Prisma,
} from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { entryRow } from '../dishes/dishes.test-helpers';
import { SuggestionsService } from '../dishes/suggestions.service';
import { CatalogService } from './catalog.service';

const ADMIN_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

/** Legacy admin writes only ever match an unowned (Lab's Food) row. */
const LABS_FOOD_MEAL_1 = { id: 'meal-1', chefProfileId: null };

const knownRequestError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: 'test',
  });

/** A Lab's Food row as stored once its lines compose (Recettes §6.1). */
const storedMeal = (overrides: Record<string, unknown> = {}) => ({
  id: 'meal-1',
  chefProfileId: null,
  allergens: [] as string[],
  allergensNone: false,
  addedAllergens: [] as string[],
  conditionalAllergens: [] as string[],
  customAllergens: [] as string[],
  ingredients: [] as unknown[],
  dietaryTags: [] as string[],
  customDiets: [] as string[],
  country: 'SN' as string | null,
  offeredToChefProfileId: null as string | null,
  lockVersion: 3,
  ...overrides,
});

/** The common list as these specs read it: milk, rice, and one chef's private entry. */
const ENTRIES = [
  entryRow({ id: 'cat-milk', name: 'Lait', allergens: ['milk'], allergensNone: false }),
  entryRow({ id: 'cat-rice', name: 'Riz', allergens: [], allergensNone: true }),
  entryRow({ id: 'cat-private', name: 'Épice maison', chefProfileId: 'chef-9' }),
];

const MILK_LINE = { name: 'Lait', qty: 1, unit: 'l', catalogIngredientId: 'cat-milk' };
const RICE_LINE = { name: 'Riz', qty: 1, unit: 'kg', catalogIngredientId: 'cat-rice' };
const PRIVATE_LINE = {
  name: 'Épice',
  qty: 1,
  unit: 'g',
  catalogIngredientId: 'cat-private',
};

describe('CatalogService', () => {
  let service: CatalogService;
  let catalogIngredient: { findMany: jest.Mock };
  let meal: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let menuWeek: {
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let suggestions: { flagCopies: jest.Mock };

  beforeEach(async () => {
    meal = {
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => null),
      findFirst: jest.fn(async () => null),
      create: jest.fn(async (args: unknown) => args),
      update: jest.fn(async (args: unknown) => args),
      delete: jest.fn(async () => undefined),
    };
    suggestions = { flagCopies: jest.fn(async () => undefined) };
    catalogIngredient = {
      findMany: jest.fn(async (args: { where: { id: { in: string[] } } }) =>
        ENTRIES.filter((entry) => args.where.id.in.includes(entry.id)),
      ),
    };
    menuWeek = {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async (args: unknown) => args),
      update: jest.fn(async () => ({ id: 'week-1', meals: [] })),
      delete: jest.fn(async () => undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CatalogService,
        {
          provide: PrismaService,
          useValue: {
            meal,
            menuWeek,
            catalogIngredient,
            platformSetting: { findUnique: jest.fn(async () => null) },
          },
        },
        { provide: SuggestionsService, useValue: suggestions },
      ],
    }).compile();

    service = moduleRef.get(CatalogService);
  });

  describe('createMeal', () => {
    it('persists imageUrl and the full metadata set', async () => {
      await service.createMeal(
        {
          name: 'Poulet yassa',
          prepTime: 45,
          imageUrl: 'https://cdn.example.com/meals/yassa.jpg',
          continent: MealContinent.africa,
          country: 'Sénégal',
          portions: 6,
          calories: 620,
          difficulty: MealDifficulty.medium,
          steps: [{ text: 'Marinate', type: 'preparation' }, { text: 'Sear' }],
          isFeatured: true,
          status: MealStatus.published,
        },
        ADMIN_ID,
      );

      expect(meal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Poulet yassa',
          imageUrl: 'https://cdn.example.com/meals/yassa.jpg',
          continent: MealContinent.africa,
          country: 'Sénégal',
          portions: 6,
          calories: 620,
          difficulty: MealDifficulty.medium,
          steps: [
            { order: 1, text: 'Marinate', type: 'preparation', durationMinutes: null },
            { order: 2, text: 'Sear', type: null, durationMinutes: null },
          ],
          isFeatured: true,
          status: MealStatus.published,
        }),
      });
    });

    it('stores null for an omitted imageUrl and defaults status to draft', async () => {
      await service.createMeal({ name: 'Thieboudienne', prepTime: 60 }, ADMIN_ID);

      const { data } = meal.create.mock.calls[0][0];
      expect(data.imageUrl).toBeNull();
      expect(data.status).toBe(MealStatus.draft);
    });

    it('leaves columns with schema defaults undefined when omitted', async () => {
      await service.createMeal({ name: 'Mafé', prepTime: 90 }, ADMIN_ID);

      const { data } = meal.create.mock.calls[0][0];
      expect(data.portions).toBeUndefined();
      expect(data.steps).toBeUndefined();
      expect(data.isFeatured).toBeUndefined();
    });

    it('stores no freezable key when none is sent, and freezable false as false (R20)', async () => {
      await service.createMeal(
        { name: 'Mafé', prepTime: 90, storage: { method: 'fridge', days: 3 } },
        ADMIN_ID,
      );
      await service.createMeal(
        {
          name: 'Mafé',
          prepTime: 90,
          storage: { method: 'fridge', days: 3, freezable: false },
        },
        ADMIN_ID,
      );

      const first = meal.create.mock.calls[0][0].data.storage;
      expect(first).toEqual({
        method: 'fridge',
        days: 3,
        container: null,
        freezerMonths: null,
        thawing: null,
      });
      expect(first).not.toHaveProperty('freezable');
      expect(meal.create.mock.calls[1][0].data.storage).toMatchObject({
        freezable: false,
      });
    });

    it('records the admin as author and never sets an owner', async () => {
      await service.createMeal({ name: 'Mafé', prepTime: 90 }, ADMIN_ID);

      const { data } = meal.create.mock.calls[0][0];
      expect(data.createdByUserId).toBe(ADMIN_ID);
      expect(data).not.toHaveProperty('chefProfileId');
    });
  });

  describe('declaration', () => {
    it('refuses a free-text allergen that is a regulated one on create', async () => {
      await expect(
        service.createMeal(
          { name: 'Mafé', prepTime: 90, customAllergens: ['peanuts'] },
          ADMIN_ID,
        ),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_FAILED' } });
      expect(meal.create).not.toHaveBeenCalled();
    });

    it('checks an update against the meal as stored', async () => {
      meal.findFirst.mockResolvedValueOnce(storedMeal({ customDiets: ['halal'] }));

      await expect(
        service.updateMeal('meal-1', { addedAllergens: ['celery'] }, ADMIN_ID),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_FAILED' } });
      expect(meal.findFirst).toHaveBeenCalledWith({ where: LABS_FOOD_MEAL_1 });
      expect(meal.update).not.toHaveBeenCalled();
    });

    it('refuses a line that breaks the rules with 422 VALIDATION_FAILED', async () => {
      await expect(
        service.createMeal(
          {
            name: 'Mafé',
            prepTime: 90,
            ingredients: [{ name: 'Arachide', qty: -2, unit: 'g' }],
          },
          ADMIN_ID,
        ),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_FAILED' } });
      expect(meal.create).not.toHaveBeenCalled();
    });

    it('refuses two lines saying the same thing with 422 DUPLICATE_INGREDIENT_LINE', async () => {
      await expect(
        service.createMeal(
          { name: 'Mafé', prepTime: 90, ingredients: [RICE_LINE, RICE_LINE] },
          ADMIN_ID,
        ),
      ).rejects.toMatchObject({ response: { code: 'DUPLICATE_INGREDIENT_LINE' } });
      expect(meal.create).not.toHaveBeenCalled();
    });

    it('stores ingredients as stamped lines, the optional fields with their defaults', async () => {
      await service.createMeal(
        {
          name: 'Mafé',
          prepTime: 90,
          ingredients: [{ name: 'Arachide', qty: 200, unit: 'g', aisle: 'epicerie' }],
        },
        ADMIN_ID,
      );

      expect(meal.create.mock.calls[0][0].data.ingredients).toEqual([
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
          allergens: [],
          incomplete: false,
        },
      ]);
    });

    it('refuses a recipe beyond a cap with 422 LIMIT_REACHED', async () => {
      await expect(
        service.updateMeal(
          'meal-1',
          { steps: Array(41).fill({ text: 'Mélanger' }) },
          ADMIN_ID,
        ),
      ).rejects.toMatchObject({ response: { code: 'LIMIT_REACHED', limit: 'steps' } });
      expect(meal.update).not.toHaveBeenCalled();
    });
  });

  it('refuses to publish a meal still offered to a chef', async () => {
    meal.findFirst.mockResolvedValueOnce(
      storedMeal({ allergensNone: true, offeredToChefProfileId: 'chef-2' }),
    );

    await expect(
      service.updateMeal('meal-1', { status: MealStatus.published }, ADMIN_ID),
    ).rejects.toMatchObject({ response: { code: 'OFFER_PENDING' } });
    expect(meal.update).not.toHaveBeenCalled();
  });

  it('makes a new recipe version when the recipe changes, not otherwise', async () => {
    await service.updateMeal('meal-1', { steps: [{ text: 'Mariner' }] }, ADMIN_ID);
    await service.updateMeal('meal-1', { description: 'Plus relevé.' }, ADMIN_ID);

    expect(meal.update.mock.calls[0][0].data.recipeVersion).toEqual({ increment: 1 });
    expect(meal.update.mock.calls[1][0].data).not.toHaveProperty('recipeVersion');
  });

  describe('computed allergens (Recettes §6.1)', () => {
    it('creates with the stamped lines and the allergens they bring', async () => {
      await service.createMeal(
        {
          name: 'Riz au lait',
          prepTime: 30,
          ingredients: [MILK_LINE, RICE_LINE],
          addedAllergens: ['celery'],
          customAllergens: ['kiwi'],
        },
        ADMIN_ID,
      );

      const { data } = meal.create.mock.calls[0][0];
      expect(data).toMatchObject({
        allergens: ['milk', 'celery'],
        conditionalAllergens: [],
        allergensNone: false,
        addedAllergens: ['celery'],
        customAllergens: ['kiwi'],
      });
      expect(data.classification).toBeDefined();
      expect(data.ingredients).toEqual([
        expect.objectContaining({ catalogIngredientId: 'cat-milk', allergens: ['milk'] }),
        expect.objectContaining({ catalogIngredientId: 'cat-rice', allergens: [] }),
      ]);
    });

    it('counts the admin’s save as the check when every line is known, not otherwise', async () => {
      await service.createMeal(
        { name: 'Riz au lait', prepTime: 30, ingredients: [MILK_LINE, RICE_LINE] },
        ADMIN_ID,
      );
      await service.createMeal(
        {
          name: 'Mafé',
          prepTime: 90,
          ingredients: [{ name: 'Arachide', qty: 1, unit: 'kg' }],
        },
        ADMIN_ID,
      );
      await service.createMeal({ name: 'Riz', prepTime: 20 }, ADMIN_ID);

      expect(meal.create.mock.calls[0][0].data.allergensVerifiedAt).toBeInstanceOf(Date);
      expect(meal.create.mock.calls[1][0].data.allergensVerifiedAt).toBeNull();
      expect(meal.create.mock.calls[2][0].data.allergensVerifiedAt).toBeNull();
    });

    it('refuses a private ingredient in a Lab’s Food recipe with 422, writing nothing', async () => {
      await expect(
        service.createMeal(
          { name: 'Mafé', prepTime: 90, ingredients: [PRIVATE_LINE] },
          ADMIN_ID,
        ),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_FAILED' } });
      expect(meal.create).not.toHaveBeenCalled();

      meal.findFirst.mockResolvedValueOnce(storedMeal());
      await expect(
        service.updateMeal('meal-1', { ingredients: [PRIVATE_LINE] }, ADMIN_ID),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_FAILED' } });
      expect(meal.update).not.toHaveBeenCalled();
    });

    it('recomposes the stored lines when only the extras are sent', async () => {
      meal.findFirst.mockResolvedValueOnce(
        storedMeal({
          ingredients: [
            { ...RICE_LINE, hiddenFromClient: false, allergens: [], incomplete: false },
          ],
        }),
      );

      await service.updateMeal('meal-1', { addedAllergens: ['celery'] }, ADMIN_ID);

      const { data } = meal.update.mock.calls[0][0];
      expect(data).toMatchObject({ allergens: ['celery'], addedAllergens: ['celery'] });
      expect(data.ingredients).toEqual([
        expect.objectContaining({ catalogIngredientId: 'cat-rice', name: 'Riz' }),
      ]);
      expect(data.allergensVerifiedAt).toBeInstanceOf(Date);
    });

    it('checks again on every recomposition: now when complete, null otherwise', async () => {
      meal.findFirst.mockResolvedValueOnce(storedMeal());
      await service.updateMeal('meal-1', { ingredients: [RICE_LINE] }, ADMIN_ID);
      meal.findFirst.mockResolvedValueOnce(
        storedMeal({ allergensVerifiedAt: new Date() }),
      );
      await service.updateMeal(
        'meal-1',
        { ingredients: [{ name: 'Arachide', qty: 1, unit: 'kg' }] },
        ADMIN_ID,
      );

      expect(meal.update.mock.calls[0][0].data.allergensVerifiedAt).toBeInstanceOf(Date);
      expect(meal.update.mock.calls[1][0].data.allergensVerifiedAt).toBeNull();
    });

    it('leaves the allergens and the verification alone when nothing recomposes', async () => {
      await service.updateMeal('meal-1', { description: 'Plus relevé.' }, ADMIN_ID);

      const { data } = meal.update.mock.calls[0][0];
      for (const key of [
        'ingredients',
        'allergens',
        'allergensNone',
        'addedAllergens',
        'allergensVerifiedAt',
      ]) {
        expect(data).not.toHaveProperty(key);
      }
    });

    // Recettes §7.3, ruling R12: the propagation's guard sees a Lab's Food save too.
    it('writes a recomposed meal on the lockVersion read, and moves it on', async () => {
      meal.findFirst.mockResolvedValueOnce(storedMeal());

      await service.updateMeal('meal-1', { ingredients: [RICE_LINE] }, ADMIN_ID);

      const { where, data } = meal.update.mock.calls[0][0];
      expect(where).toEqual({ id: 'meal-1', chefProfileId: null, lockVersion: 3 });
      expect(data.lockVersion).toEqual({ increment: 1 });
    });

    it('answers 409 RECIPE_CONFLICT, writing nothing, when a propagation landed meanwhile', async () => {
      const read = storedMeal({
        ingredients: [
          { ...RICE_LINE, hiddenFromClient: false, allergens: [], incomplete: false },
        ],
      });
      // The propagation wrote between the admin's read and write: lockVersion 3 → 4.
      let row = { ...read, lockVersion: 4 };
      meal.findFirst.mockResolvedValueOnce(read);
      meal.update.mockImplementationOnce(
        async ({ where, data }: { where: { lockVersion?: number }; data: object }) => {
          if (where.lockVersion !== row.lockVersion) throw knownRequestError('P2025');
          row = { ...row, ...data };
          return row;
        },
      );
      meal.findUnique.mockImplementationOnce(async () => ({
        chefProfileId: row.chefProfileId,
        lockVersion: row.lockVersion,
      }));

      const error = await service
        .updateMeal('meal-1', { ingredients: [MILK_LINE] }, ADMIN_ID)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'RECIPE_CONFLICT',
        lockVersion: 4,
      });
      expect(row.ingredients).toEqual(read.ingredients);
      expect(suggestions.flagCopies).not.toHaveBeenCalled();
    });

    it('keeps a hand-declared allergen of an existing row, as added (R7)', async () => {
      meal.findFirst.mockResolvedValueOnce(
        storedMeal({
          allergens: ['milk'],
          ingredients: [{ name: 'Crème', qty: 1, unit: 'l', catalogIngredientId: null }],
        }),
      );

      await service.updateMeal('meal-1', { ingredients: [RICE_LINE] }, ADMIN_ID);

      expect(meal.update.mock.calls[0][0].data).toMatchObject({
        allergens: ['milk'],
        addedAllergens: ['milk'],
      });
    });
  });

  it('makes no version for a reheating change (Recettes §4.6)', async () => {
    await service.updateMeal('meal-1', { reheating: { modes: ['oven'] } }, ADMIN_ID);

    expect(meal.update.mock.calls[0][0].data.reheating).toMatchObject({
      modes: ['oven'],
    });
    expect(meal.update.mock.calls[0][0].data).not.toHaveProperty('recipeVersion');
  });

  describe('source-changed (PRD)', () => {
    const rice = {
      ...RICE_LINE,
      hiddenFromClient: false,
      allergens: [] as string[],
      incomplete: false,
    };
    const stored = storedMeal({ ingredients: [rice], allergensNone: true });

    it('flags the copies when the computed allergens change', async () => {
      meal.findFirst.mockResolvedValueOnce(stored);
      // The write answers the row as the database would; here it echoes the stored one.
      meal.update.mockResolvedValueOnce(stored);

      await service.updateMeal('meal-1', { ingredients: [rice, MILK_LINE] }, ADMIN_ID);

      expect(suggestions.flagCopies).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'meal-1' }),
        ADMIN_ID,
      );
    });

    it('flags the copies when a safety field really changes', async () => {
      meal.findFirst.mockResolvedValueOnce(stored);
      meal.update.mockResolvedValueOnce({ ...stored, country: 'FR' });

      await service.updateMeal('meal-1', { country: 'FR' }, ADMIN_ID);

      expect(suggestions.flagCopies).toHaveBeenCalledTimes(1);
    });

    it('leaves copies alone when the same lines are sent again, or comfort fields change', async () => {
      meal.findFirst.mockResolvedValueOnce(stored);
      meal.update.mockResolvedValueOnce(stored);
      await service.updateMeal('meal-1', { ingredients: [RICE_LINE] }, ADMIN_ID);

      meal.update.mockResolvedValueOnce(stored);
      await service.updateMeal('meal-1', { description: 'Plus relevé.' }, ADMIN_ID);

      expect(suggestions.flagCopies).not.toHaveBeenCalled();
    });

    it('leaves copies alone when carrying a hand-declared allergen changes nothing', async () => {
      const legacy = storedMeal({ allergens: ['milk'] });
      meal.findFirst.mockResolvedValueOnce(legacy);
      meal.update.mockResolvedValueOnce(legacy);

      await service.updateMeal('meal-1', { addedAllergens: [] }, ADMIN_ID);

      expect(suggestions.flagCopies).not.toHaveBeenCalled();
    });
  });

  describe('listMeals', () => {
    it("lists Lab's Food meals only", async () => {
      await service.listMeals();

      expect(meal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { chefProfileId: null } }),
      );
    });
  });

  describe('updateMeal', () => {
    it('passes null through for nullable columns so they can be cleared', async () => {
      await service.updateMeal('meal-1', { imageUrl: null, calories: null }, ADMIN_ID);

      expect(meal.update).toHaveBeenCalledWith({
        where: LABS_FOOD_MEAL_1,
        data: { imageUrl: null, calories: null },
      });
    });

    it('ignores null on non-nullable columns instead of forwarding it to Prisma', async () => {
      await service.updateMeal(
        'meal-1',
        {
          portions: null as never,
          status: null as never,
          name: 'Renamed',
        },
        ADMIN_ID,
      );

      expect(meal.update).toHaveBeenCalledWith({
        where: LABS_FOOD_MEAL_1,
        data: { name: 'Renamed' },
      });
    });

    it('omits untouched fields from the update payload', async () => {
      await service.updateMeal(
        'meal-1',
        {
          imageUrl: 'https://cdn.example.com/meals/new.jpg',
        },
        ADMIN_ID,
      );

      expect(meal.update).toHaveBeenCalledWith({
        where: LABS_FOOD_MEAL_1,
        data: { imageUrl: 'https://cdn.example.com/meals/new.jpg' },
      });
    });

    it("refuses a chef's dish with 403 CONTENT_NOT_OWNED", async () => {
      meal.update.mockRejectedValueOnce(knownRequestError('P2025'));
      meal.findUnique.mockResolvedValueOnce({ chefProfileId: 'chef-1' });

      const error = await service
        .updateMeal('meal-1', { name: 'Taken over' }, ADMIN_ID)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: 'CONTENT_NOT_OWNED',
      });
    });

    it('answers 404 for an unknown id', async () => {
      meal.update.mockRejectedValueOnce(knownRequestError('P2025'));

      await expect(
        service.updateMeal('missing', { name: 'x' }, ADMIN_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('deleteMeal', () => {
    it('deletes the meal', async () => {
      await service.deleteMeal('meal-1');

      expect(meal.delete).toHaveBeenCalledWith({ where: LABS_FOOD_MEAL_1 });
    });

    it("refuses a chef's dish with 403 CONTENT_NOT_OWNED", async () => {
      meal.delete.mockRejectedValueOnce(knownRequestError('P2025'));
      meal.findUnique.mockResolvedValueOnce({ chefProfileId: 'chef-1' });

      await expect(service.deleteMeal('meal-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('maps a missing record (P2025) to NotFoundException', async () => {
      meal.delete.mockRejectedValueOnce(knownRequestError('P2025'));

      await expect(service.deleteMeal('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('maps a booking reference (P2003) to ConflictException', async () => {
      meal.delete.mockRejectedValueOnce(knownRequestError('P2003'));

      await expect(service.deleteMeal('meal-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rethrows unexpected errors untouched', async () => {
      const failure = new Error('connection lost');
      meal.delete.mockRejectedValueOnce(failure);

      await expect(service.deleteMeal('meal-1')).rejects.toBe(failure);
    });
  });

  describe('createMenuWeek', () => {
    it("puts Lab's Food meals on the menu, each once", async () => {
      meal.findMany.mockResolvedValueOnce([{ id: 'meal-1', chefProfileId: null }]);

      await service.createMenuWeek({
        year: 2026,
        weekNumber: 40,
        mealIds: ['meal-1', 'meal-1'],
      });

      const { data } = menuWeek.create.mock.calls[0][0];
      expect(data.meals.create).toEqual([{ meal: { connect: { id: 'meal-1' } } }]);
    });

    it("refuses a chef's dish with 403 CONTENT_NOT_OWNED", async () => {
      meal.findMany.mockResolvedValueOnce([{ id: 'meal-1', chefProfileId: 'chef-1' }]);

      await expect(
        service.createMenuWeek({ year: 2026, weekNumber: 40, mealIds: ['meal-1'] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(menuWeek.create).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown meal id instead of a server error', async () => {
      meal.findMany.mockResolvedValueOnce([]);

      await expect(
        service.createMenuWeek({ year: 2026, weekNumber: 40, mealIds: ['missing'] }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('answers 409 MENU_WEEK_EXISTS when the week already has a menu', async () => {
      menuWeek.create.mockRejectedValueOnce(knownRequestError('P2002'));

      await expect(
        service.createMenuWeek({ year: 2026, weekNumber: 40 }),
      ).rejects.toMatchObject({ response: { code: 'MENU_WEEK_EXISTS' } });
    });
  });

  describe('updateMenuWeek', () => {
    it('replaces the meals in the same write, each once', async () => {
      meal.findMany.mockResolvedValueOnce([{ id: 'meal-2', chefProfileId: null }]);

      await service.updateMenuWeek('week-1', { mealIds: ['meal-2', 'meal-2'] });

      const { where, data } = menuWeek.update.mock.calls[0][0];
      expect(where).toEqual({ id: 'week-1' });
      expect(data.meals).toEqual({
        deleteMany: {},
        create: [{ meal: { connect: { id: 'meal-2' } } }],
      });
    });

    it('leaves the meals alone when mealIds is omitted or null', async () => {
      await service.updateMenuWeek('week-1', { weekNumber: 41 });
      await service.updateMenuWeek('week-1', { mealIds: null as never });

      expect(menuWeek.update.mock.calls[0][0].data).toEqual({
        year: undefined,
        weekNumber: 41,
        meals: undefined,
      });
      expect(menuWeek.update.mock.calls[1][0].data.meals).toBeUndefined();
      expect(meal.findMany).not.toHaveBeenCalled();
    });

    it("refuses a chef's dish before writing", async () => {
      meal.findMany.mockResolvedValueOnce([{ id: 'meal-1', chefProfileId: 'chef-1' }]);

      await expect(
        service.updateMenuWeek('week-1', { mealIds: ['meal-1'] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(menuWeek.update).not.toHaveBeenCalled();
    });

    it('answers 404 MENU_WEEK_NOT_FOUND for an unknown id', async () => {
      menuWeek.update.mockRejectedValueOnce(knownRequestError('P2025'));

      await expect(
        service.updateMenuWeek('missing', { weekNumber: 41 }),
      ).rejects.toMatchObject({ response: { code: 'MENU_WEEK_NOT_FOUND' } });
    });

    it('answers 409 MENU_WEEK_EXISTS when moved onto a taken week', async () => {
      menuWeek.update.mockRejectedValueOnce(knownRequestError('P2002'));

      await expect(
        service.updateMenuWeek('week-1', { weekNumber: 41 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('deleteMenuWeek', () => {
    it('deletes the menu', async () => {
      await service.deleteMenuWeek('week-1');

      expect(menuWeek.delete).toHaveBeenCalledWith({ where: { id: 'week-1' } });
    });

    it('answers 404 MENU_WEEK_NOT_FOUND for an unknown id', async () => {
      menuWeek.delete.mockRejectedValueOnce(knownRequestError('P2025'));

      await expect(service.deleteMenuWeek('missing')).rejects.toMatchObject({
        response: { code: 'MENU_WEEK_NOT_FOUND' },
      });
    });
  });
});
