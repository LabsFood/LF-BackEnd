import { ConflictException, NotFoundException } from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { IngredientsService } from './ingredients.service';

const TOMATE = {
  id: 'ing-1',
  name: 'Tomate',
  aliases: ['pomme d’amour'],
  diets: ['vegan', 'vegetarian'],
  seasonMonths: [6, 7, 8, 9],
  createdAt: new Date('2026-11-02T09:00:00.000Z'),
  updatedAt: new Date('2026-11-02T09:00:00.000Z'),
};

function harness() {
  const catalogIngredient = {
    findMany: jest.fn(async (_args?: unknown): Promise<unknown[]> => [TOMATE]),
    findFirst: jest.fn(async (_args?: unknown): Promise<unknown> => null),
    count: jest.fn(async (_args?: unknown) => 1),
    create: jest.fn(async ({ data }: { data: object }) => ({ ...TOMATE, ...data })),
    update: jest.fn(async ({ data }: { data: object }) => ({ ...TOMATE, ...data })),
  };
  const meal = {
    findMany: jest.fn(async (_args?: unknown): Promise<unknown[]> => []),
    update: jest.fn(async (_args?: unknown) => ({})),
  };
  const chefIngredient = {
    findMany: jest.fn(async (_args?: unknown): Promise<unknown[]> => []),
    findFirst: jest.fn(async (_args?: unknown): Promise<unknown> => null),
    count: jest.fn(async (_args?: unknown) => 0),
    upsert: jest.fn(async ({ create }: { create: object }) => ({
      id: 'own-1',
      ...create,
    })),
    update: jest.fn(async ({ data }: { data: object }) => ({ id: 'own-1', ...data })),
    delete: jest.fn(async (_args?: unknown) => ({})),
  };
  const platformSetting = {
    findUnique: jest.fn(async (_args?: unknown): Promise<unknown> => null),
    upsert: jest.fn(async (_args?: unknown) => ({})),
  };
  const audit = { record: jest.fn(async (_entry: object) => undefined) };
  const service = new IngredientsService(
    {
      catalogIngredient,
      meal,
      chefIngredient,
      platformSetting,
    } as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { catalogIngredient, meal, chefIngredient, platformSetting, audit, service };
}

describe('IngredientsService (Recettes §4.10)', () => {
  it('adds an ingredient, names kept as typed and aliases folded, and journals it', async () => {
    const { catalogIngredient, audit, service } = harness();

    await service.create(
      {
        name: ' Tomate ',
        aliases: [' Pomme d’amour '],
        diets: ['vegan'],
        seasonMonths: [7, 6, 7],
      },
      'admin-1',
    );

    expect(catalogIngredient.create).toHaveBeenCalledWith({
      data: {
        name: 'Tomate',
        aliases: ['pomme d’amour'],
        diets: ['vegan'],
        seasonMonths: [6, 7],
      },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'catalog_ingredient.created' }),
    );
  });

  it('refuses a name already in the list, whatever the case', async () => {
    const { catalogIngredient, service } = harness();
    catalogIngredient.findFirst.mockResolvedValue(TOMATE);

    await expect(service.create({ name: 'TOMATE' }, 'admin-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(catalogIngredient.create).not.toHaveBeenCalled();
  });

  it('finds an ingredient by its name or another name, 20 at most', async () => {
    const { catalogIngredient, service } = harness();

    await service.search('Pomme');

    expect(catalogIngredient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { name: { contains: 'Pomme', mode: 'insensitive' } },
            { aliases: { has: 'pomme' } },
          ],
        },
        take: 20,
      }),
    );
  });

  it('classifies again the dishes that link a changed ingredient', async () => {
    const { catalogIngredient, meal, service } = harness();
    meal.findMany.mockResolvedValue([
      {
        id: 'dish-1',
        chefProfileId: null,
        ingredients: [{ name: 'Tomate', catalogIngredientId: 'ing-1' }],
      },
    ]);
    catalogIngredient.findMany.mockResolvedValue([
      { id: 'ing-1', diets: ['vegan'], seasonMonths: [] },
    ]);

    await service.update('ing-1', { diets: ['vegan'] }, 'admin-1');

    expect(meal.update).toHaveBeenCalledWith({
      where: { id: 'dish-1' },
      data: {
        classification: {
          diets: ['vegan'],
          seasonMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        },
      },
    });
  });

  it('lists the whole list by page for the console', async () => {
    const { service } = harness();

    const page = await service.list({ page: 1, limit: 50 });

    expect(page.meta).toMatchObject({ page: 1, limit: 50, total: 1 });
    expect(page.data[0]).toMatchObject({ name: 'Tomate', seasonMonths: [6, 7, 8, 9] });
  });

  it('tells the console when the list is due a review (BLK-33)', async () => {
    const { catalogIngredient, service } = harness();
    catalogIngredient.count.mockResolvedValue(0);

    const page = await service.list({ page: 1, limit: 50 });

    expect(page.seasonReview).toMatchObject({ due: true, reason: 'empty' });
  });

  it('records that an admin reviewed the list this season, and journals it', async () => {
    const { platformSetting, audit, service } = harness();

    const review = await service.markSeasonReviewed('admin-1', 'req-1');

    expect(platformSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'ingredients_season_review' } }),
    );
    expect(review).toMatchObject({ due: false, reason: null });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'catalog_ingredient.season_reviewed' }),
    );
  });
});

describe('a batch cooker’s own ingredients (BLK-33)', () => {
  const CHEF = 'chef-1';
  const OWN = {
    id: 'own-1',
    chefProfileId: CHEF,
    catalogIngredientId: 'ing-1',
    name: 'Tomate cœur de bœuf',
    aliases: [],
    diets: ['vegan'],
    seasonMonths: [7, 8],
  };

  it('adopts an entry of the common list as a copy the chef can edit', async () => {
    const { catalogIngredient, chefIngredient, service } = harness();
    catalogIngredient.findFirst.mockResolvedValue(TOMATE);

    await service.adopt(CHEF, 'ing-1');

    expect(chefIngredient.upsert).toHaveBeenCalledWith({
      where: {
        chefProfileId_catalogIngredientId: {
          chefProfileId: CHEF,
          catalogIngredientId: 'ing-1',
        },
      },
      update: {},
      create: {
        chefProfileId: CHEF,
        catalogIngredientId: 'ing-1',
        name: 'Tomate',
        aliases: ['pomme d’amour'],
        diets: ['vegan', 'vegetarian'],
        seasonMonths: [6, 7, 8, 9],
      },
    });
  });

  it('refuses an entry the common list does not hold', async () => {
    const { chefIngredient, service } = harness();

    await expect(service.adopt(CHEF, 'gone')).rejects.toMatchObject({
      response: { code: 'INGREDIENT_NOT_FOUND' },
    });
    expect(chefIngredient.upsert).not.toHaveBeenCalled();
  });

  it('caps the number of entries a chef adopts', async () => {
    const { catalogIngredient, chefIngredient, service } = harness();
    catalogIngredient.findFirst.mockResolvedValue(TOMATE);
    chefIngredient.count.mockResolvedValue(500);

    await expect(service.adopt(CHEF, 'ing-1')).rejects.toMatchObject({
      response: { code: 'CHEF_INGREDIENTS_LIMIT' },
    });
  });

  it('edits only the chef’s own version, and classifies their dishes from it', async () => {
    const { chefIngredient, catalogIngredient, meal, service } = harness();
    chefIngredient.findFirst.mockResolvedValue(OWN);
    chefIngredient.findMany.mockResolvedValue([OWN]);
    catalogIngredient.findMany.mockResolvedValue([TOMATE]);
    meal.findMany.mockResolvedValue([
      {
        id: 'dish-1',
        chefProfileId: CHEF,
        ingredients: [{ name: 'Tomate', catalogIngredientId: 'ing-1' }],
      },
    ]);

    await service.updateMine(CHEF, 'own-1', { seasonMonths: [8, 7] });

    expect(chefIngredient.findFirst).toHaveBeenCalledWith({
      where: { id: 'own-1', chefProfileId: CHEF },
    });
    expect(chefIngredient.update).toHaveBeenCalledWith({
      where: { id: 'own-1' },
      data: { seasonMonths: [7, 8] },
    });
    expect(meal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ chefProfileId: CHEF }),
      }),
    );
    expect(meal.update).toHaveBeenCalledWith({
      where: { id: 'dish-1' },
      data: { classification: { diets: ['vegan'], seasonMonths: [7, 8] } },
    });
  });

  it('answers 404 for another chef’s version', async () => {
    const { chefIngredient, service } = harness();

    await expect(
      service.updateMine(CHEF, 'theirs', { diets: [] }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.removeMine(CHEF, 'theirs')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(chefIngredient.update).not.toHaveBeenCalled();
    expect(chefIngredient.delete).not.toHaveBeenCalled();
  });

  it('keeps a chef’s version when the admin changes the common entry', async () => {
    const { catalogIngredient, chefIngredient, meal, service } = harness();
    meal.findMany.mockResolvedValue([
      {
        id: 'dish-1',
        chefProfileId: CHEF,
        ingredients: [{ name: 'Tomate', catalogIngredientId: 'ing-1' }],
      },
    ]);
    catalogIngredient.findMany.mockResolvedValue([
      { id: 'ing-1', diets: [], seasonMonths: [] },
    ]);
    chefIngredient.findMany.mockResolvedValue([OWN]);

    await service.update('ing-1', { diets: [] }, 'admin-1');

    expect(meal.update).toHaveBeenCalledWith({
      where: { id: 'dish-1' },
      data: { classification: { diets: ['vegan'], seasonMonths: [7, 8] } },
    });
  });
});
