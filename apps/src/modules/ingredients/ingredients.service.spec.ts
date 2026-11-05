import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IngredientPropagationService } from './ingredient-propagation.service';
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
  const propagation = {
    propagate: jest.fn(async (..._args: unknown[]) => ({
      dishes: 2,
      reverified: 1,
      chefs: 1,
      skipped: 0,
    })),
  };
  const service = new IngredientsService(
    { catalogIngredient, meal, platformSetting } as unknown as PrismaService,
    audit as unknown as AuditService,
    propagation as unknown as IngredientPropagationService,
  );
  return { catalogIngredient, meal, audit, propagation, service };
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

  // Recettes §7.3: what a recipe line copies or computes from the entry.
  it.each([
    ['name', { name: 'Tomate cerise' }],
    ['aisle', { aisle: 'cremerie' }],
    ['allergens', { allergens: ['gluten'] }],
    ['allergensNone', { allergensNone: false }],
    ['diets', { diets: ['vegetarian'] }],
    ['seasonMonths', { seasonMonths: [1] }],
  ])('carries a change of %s into the recipes', async (_field, payload) => {
    const { audit, meal, propagation, service } = harness();

    await service.update('ing-1', payload, 'admin-1');

    expect(propagation.propagate).toHaveBeenCalledWith(['ing-1'], 'admin-1');
    // The propagation writes the dishes, never this service.
    expect(meal.update).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'catalog_ingredient.updated',
        subjectId: 'ing-1',
      }),
    );
  });

  it.each([
    ['the same values again', { name: 'Tomate', seasonMonths: [9, 8, 7, 6] }],
    ['other names', { aliases: ['tomates'] }],
    ['the basic flag', { isBasic: true }],
    // Recettes §5.1: an inactive entry stays valid on the lines that have it.
    ['a deactivation', { status: 'inactive' as const }],
  ])('carries nothing for %s', async (_case, payload) => {
    const { propagation, service } = harness();

    await service.update('ing-1', payload, 'admin-1');

    expect(propagation.propagate).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown ingredient and carries nothing', async () => {
    const { catalogIngredient, propagation, service } = harness();
    catalogIngredient.findUnique.mockResolvedValue(null);

    await expect(
      service.update('nope', { name: 'Tomate cerise' }, 'admin-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(catalogIngredient.update).not.toHaveBeenCalled();
    expect(propagation.propagate).not.toHaveBeenCalled();
  });

  // Recettes §7.2: what a change would touch, before the admin saves it.
  it('counts the dishes, chefs and verified dishes linking an ingredient', async () => {
    const { meal, service } = harness();
    meal.findMany.mockResolvedValue([
      { chefProfileId: 'chef-1', allergensVerifiedAt: new Date() },
      { chefProfileId: 'chef-1', allergensVerifiedAt: null },
      { chefProfileId: 'chef-2', allergensVerifiedAt: new Date() },
      // A Lab's Food recipe: a dish, no chef.
      { chefProfileId: null, allergensVerifiedAt: new Date() },
    ]);

    const impact = await service.impact('ing-1');

    expect(impact).toEqual({ dishes: 4, chefs: 2, verifiedDishes: 3 });
    expect(meal.findMany).toHaveBeenCalledWith({
      where: {
        OR: [{ ingredients: { array_contains: [{ catalogIngredientId: 'ing-1' }] } }],
      },
      select: { chefProfileId: true, allergensVerifiedAt: true },
    });
  });

  it('answers 404 for the impact of an unknown ingredient', async () => {
    const { catalogIngredient, meal, service } = harness();
    catalogIngredient.findUnique.mockResolvedValue(null);

    await expect(service.impact('nope')).rejects.toBeInstanceOf(NotFoundException);
    expect(meal.findMany).not.toHaveBeenCalled();
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
  it.each(['merged', 'pending'])(
    'refuses a status change on a %s entry and writes nothing',
    async (status) => {
      const { catalogIngredient, audit, service } = harness();
      catalogIngredient.findUnique.mockResolvedValue({ ...TOMATE, status });

      await expect(
        service.update('ing-1', { status: 'active' }, 'a'),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(catalogIngredient.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    },
  );

  it('answers 409 with the entry that won when a renaming collides on the index', async () => {
    const { catalogIngredient, service } = harness();
    catalogIngredient.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('x', {
        code: 'P2002',
        clientVersion: '0',
      }),
    );
    catalogIngredient.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'ing-9', name: 'Crème' });

    const error = await service
      .update('ing-1', { name: 'CRÈME' }, 'a')
      .catch((e: unknown) => e);

    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'INGREDIENT_ALREADY_LISTED',
      ingredient: { id: 'ing-9', name: 'Crème' },
    });
  });

  it('keeps the ingredient body on a P2002 when no name was sent', async () => {
    const { catalogIngredient, service } = harness();
    catalogIngredient.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('x', {
        code: 'P2002',
        clientVersion: '0',
      }),
    );
    catalogIngredient.findFirst.mockResolvedValue({ id: 'ing-9', name: 'Tomate' });

    const error = await service
      .update('ing-1', { isBasic: true }, 'a')
      .catch((e: unknown) => e);

    expect((error as ConflictException).getResponse()).toMatchObject({
      ingredient: { id: 'ing-9', name: 'Tomate' },
    });
    expect(catalogIngredient.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ normalizedName: 'tomate' }),
      }),
    );
  });

  it('excludes the entry itself from the uniqueness check when renaming it', async () => {
    const { catalogIngredient, service } = harness();

    await service.update('ing-1', { name: 'TOMATE' }, 'a');

    expect(catalogIngredient.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          normalizedName: 'tomate',
          id: { not: 'ing-1' },
        }),
      }),
    );
    expect(catalogIngredient.update).toHaveBeenCalled();
  });
});
