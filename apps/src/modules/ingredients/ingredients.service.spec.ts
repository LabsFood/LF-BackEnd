import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IngredientsService } from './ingredients.service';

const TOMATE = {
  id: 'ing-1',
  name: 'Tomate',
  aliases: ['pomme d’amour'],
  diets: ['vegan', 'vegetarian'],
  seasonMonths: [6, 7, 8, 9],
  aisle: 'fruits-legumes',
  normalizedName: 'tomate',
  allergens: [],
  allergensNone: true,
  isBasic: false,
  status: 'active',
  chefProfileId: null,
  mergedIntoId: null,
  createdAt: new Date('2026-11-02T09:00:00.000Z'),
  updatedAt: new Date('2026-11-02T09:00:00.000Z'),
};

function harness() {
  const catalogIngredient = {
    findMany: jest.fn(async (_args?: unknown): Promise<unknown[]> => [TOMATE]),
    findFirst: jest.fn(async (_args?: unknown): Promise<unknown> => null),
    findUnique: jest.fn(async (_args?: unknown): Promise<unknown> => TOMATE),
    count: jest.fn(async (_args?: unknown) => 1),
    create: jest.fn(async ({ data }: { data: object }) => ({ ...TOMATE, ...data })),
    update: jest.fn(async ({ data }: { data: object }) => ({ ...TOMATE, ...data })),
  };
  const meal = {
    findMany: jest.fn(async (_args?: unknown): Promise<unknown[]> => []),
    update: jest.fn(async (_args?: unknown) => ({})),
  };
  const platformSetting = { findUnique: jest.fn(async (_args?: unknown) => null) };
  const audit = { record: jest.fn(async (_entry: object) => undefined) };
  const service = new IngredientsService(
    { catalogIngredient, meal, platformSetting } as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { catalogIngredient, meal, audit, service };
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
        aisle: 'fruits-legumes',
        allergensNone: true,
      },
      'admin-1',
    );

    expect(catalogIngredient.create).toHaveBeenCalledWith({
      data: {
        name: 'Tomate',
        normalizedName: 'tomate',
        aliases: ['pomme d’amour'],
        diets: ['vegetarian', 'vegan', 'no-pork', 'pescetarian'],
        seasonMonths: [6, 7],
        aisle: 'fruits-legumes',
        allergens: [],
        allergensNone: true,
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

  it('classifies again the dishes that link a changed ingredient', async () => {
    const { catalogIngredient, meal, service } = harness();
    meal.findMany.mockResolvedValue([
      { id: 'dish-1', ingredients: [{ name: 'Tomate', catalogIngredientId: 'ing-1' }] },
    ]);
    catalogIngredient.findMany.mockResolvedValue([
      {
        id: 'ing-1',
        diets: ['vegan'],
        seasonMonths: [],
        allergens: [],
        allergensNone: true,
        aisle: 'fruits-legumes',
        isBasic: false,
        name: 'Tomate',
        status: 'active',
        chefProfileId: null,
        mergedIntoId: null,
      },
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

  it('fills the normalized name and implied diets, and refuses an aisle outside the list', async () => {
    const { catalogIngredient, service } = harness();

    await service.create(
      { name: 'Crème Fraîche', diets: ['vegetarian'], aisle: 'cremerie' },
      'a',
    );
    expect(catalogIngredient.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Crème Fraîche',
        normalizedName: 'creme fraiche',
        diets: ['vegetarian', 'no-pork', 'pescetarian'],
      }),
    });

    await expect(
      service.create({ name: 'X', aisle: 'nowhere' }, 'a'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('refuses allergens and "none" together', async () => {
    const { service } = harness();
    await expect(
      service.create({ name: 'X', allergens: ['gluten'], allergensNone: true }, 'a'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      service.update('ing-1', { allergens: ['gluten'], allergensNone: true }, 'a'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('answers 409 with the entry already listed, by normalized name among common entries', async () => {
    const { catalogIngredient, service } = harness();
    catalogIngredient.findFirst.mockResolvedValue({ id: 'ing-9', name: 'Crème' });

    const error = await service.create({ name: 'CREME' }, 'a').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'INGREDIENT_ALREADY_LISTED',
      ingredient: { id: 'ing-9', name: 'Crème' },
    });
    expect(catalogIngredient.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          normalizedName: 'creme',
          chefProfileId: null,
          status: { not: 'merged' },
        }),
      }),
    );
  });

  it('keeps the allergen state coherent on update', async () => {
    const { catalogIngredient, service } = harness();
    await service.update('ing-1', { allergens: ['gluten'] }, 'a');
    expect(catalogIngredient.update).toHaveBeenLastCalledWith({
      where: { id: 'ing-1' },
      data: { allergens: ['gluten'], allergensNone: false },
    });
    await service.update('ing-1', { allergensNone: true }, 'a');
    expect(catalogIngredient.update).toHaveBeenLastCalledWith({
      where: { id: 'ing-1' },
      data: { allergens: [], allergensNone: true },
    });
  });

  it('refuses a status change on a private entry, allows it on a common one', async () => {
    const { catalogIngredient, service } = harness();
    catalogIngredient.findUnique.mockResolvedValue({
      ...TOMATE,
      chefProfileId: 'chef-1',
    });
    await expect(
      service.update('ing-1', { status: 'inactive' }, 'a'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    catalogIngredient.findUnique.mockResolvedValue(TOMATE);
    await service.update('ing-1', { status: 'inactive' }, 'a');
    expect(catalogIngredient.update).toHaveBeenCalledWith({
      where: { id: 'ing-1' },
      data: { status: 'inactive' },
    });
  });

  it('lists with the console filters', async () => {
    const { catalogIngredient, service } = harness();

    await service.list({
      page: 1,
      limit: 20,
      status: 'pending',
      aisle: 'boucherie',
      incomplete: true,
      reviewed: false,
    });

    const { where } = catalogIngredient.findMany.mock.calls[0][0] as { where: object };
    expect(where).toEqual({
      AND: [
        { status: 'pending' },
        { aisle: 'boucherie' },
        {
          OR: [
            { aisle: null },
            { AND: [{ allergens: { isEmpty: true } }, { allergensNone: false }] },
          ],
        },
        { reviewedAt: null },
      ],
    });
  });

  it('searches common active entries, accents folded, flagging private ones', async () => {
    const { catalogIngredient, service } = harness();
    catalogIngredient.findMany.mockResolvedValue([
      TOMATE,
      { ...TOMATE, id: 'p', chefProfileId: 'chef-1', status: 'pending' },
    ]);

    const found = await service.search('Crème', 'chef-1');

    expect(found.map((f) => f.private)).toEqual([false, true]);
    expect(catalogIngredient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              OR: [
                { chefProfileId: null, status: 'active' },
                { chefProfileId: 'chef-1', status: 'pending' },
              ],
            },
            {
              OR: [
                { name: { contains: 'Crème', mode: 'insensitive' } },
                { normalizedName: { contains: 'creme' } },
                { aliases: { has: 'crème' } },
              ],
            },
          ],
        },
        take: 20,
      }),
    );
  });

  it('searches without a chef: common active entries alone', async () => {
    const { catalogIngredient, service } = harness();
    await service.search('tom', null);
    const { where } = catalogIngredient.findMany.mock.calls[0][0] as {
      where: { AND: unknown[] };
    };
    expect(where.AND[0]).toEqual({ OR: [{ chefProfileId: null, status: 'active' }] });
  });

  it('marks an entry reviewed and journals it; an unknown id is a 404', async () => {
    const { catalogIngredient, audit, service } = harness();
    await service.review('ing-1', 'admin-1');
    expect(catalogIngredient.update).toHaveBeenCalledWith({
      where: { id: 'ing-1' },
      data: { reviewedAt: expect.any(Date), reviewedByUserId: 'admin-1' },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'catalog_ingredient.reviewed',
        subjectId: 'ing-1',
      }),
    );

    catalogIngredient.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('x', {
        code: 'P2025',
        clientVersion: '0',
      }),
    );
    await expect(service.review('nope', 'admin-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
