import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
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
    count: jest.fn(async (_args?: unknown) => 0),
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
      failed: 0,
    })),
  };
  const notifications = { notify: jest.fn(async (..._args: unknown[]) => ({})) };
  const service = new IngredientsService(
    { catalogIngredient, meal, platformSetting } as unknown as PrismaService,
    audit as unknown as AuditService,
    propagation as unknown as IngredientPropagationService,
    notifications as unknown as NotificationsService,
  );
  return { catalogIngredient, meal, audit, propagation, notifications, service };
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

    expect(propagation.propagate).toHaveBeenCalledWith(['ing-1'], {
      type: 'admin',
      userId: 'admin-1',
    });
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

  // Ruling R14: a run cut short is replayed by an admin.
  it('replays the propagation of an entry as the admin, and answers its figures', async () => {
    const { propagation, service } = harness();

    const result = await service.propagate('ing-1', 'admin-1');

    expect(result).toEqual({ dishes: 2, reverified: 1, chefs: 1, skipped: 0, failed: 0 });
    expect(propagation.propagate).toHaveBeenCalledWith(['ing-1'], {
      type: 'admin',
      userId: 'admin-1',
    });
  });

  it('answers 404 when replaying an unknown ingredient', async () => {
    const { catalogIngredient, propagation, service } = harness();
    catalogIngredient.findUnique.mockResolvedValue(null);

    await expect(service.propagate('nope', 'admin-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(propagation.propagate).not.toHaveBeenCalled();
  });

  // Recettes §7.2: what a change would touch, before the admin saves it.
  it('counts the dishes, chefs and verified dishes linking an ingredient', async () => {
    const { catalogIngredient, meal, service } = harness();
    // An entry merged into this one: its lines may still link it.
    catalogIngredient.findMany.mockResolvedValue([{ id: 'ing-old' }]);
    meal.findMany.mockResolvedValue([
      { chefProfileId: 'chef-1', allergensVerifiedAt: new Date() },
      { chefProfileId: 'chef-1', allergensVerifiedAt: null },
      { chefProfileId: 'chef-2', allergensVerifiedAt: new Date() },
      // A Lab's Food recipe: a dish, no chef.
      { chefProfileId: null, allergensVerifiedAt: new Date() },
    ]);

    const impact = await service.impact('ing-1');

    expect(impact).toEqual({ dishes: 4, chefs: 2, verifiedDishes: 3 });
    expect(catalogIngredient.findMany).toHaveBeenCalledWith({
      where: { mergedIntoId: { in: ['ing-1'] }, status: 'merged' },
      select: { id: true },
    });
    expect(meal.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { ingredients: { array_contains: [{ catalogIngredientId: 'ing-1' }] } },
          { ingredients: { array_contains: [{ catalogIngredientId: 'ing-old' }] } },
        ],
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
      include: { chefProfile: { select: { id: true, displayName: true } } },
    });
    await service.update('ing-1', { allergensNone: true }, 'a');
    expect(catalogIngredient.update).toHaveBeenLastCalledWith({
      where: { id: 'ing-1' },
      data: { allergens: [], allergensNone: true },
      include: { chefProfile: { select: { id: true, displayName: true } } },
    });
  });

  // A stamp copies the entry's list as stored: one order only, so a fresh
  // composition always matches it, and a reorder is no change.
  it('stores the allergens in annex order, and carries nothing for a reorder', async () => {
    const { catalogIngredient, propagation, service } = harness();
    await service.update('ing-1', { allergens: ['milk', 'gluten', 'milk'] }, 'a');
    expect(catalogIngredient.update).toHaveBeenLastCalledWith({
      where: { id: 'ing-1' },
      data: { allergens: ['gluten', 'milk'], allergensNone: false },
      include: { chefProfile: { select: { id: true, displayName: true } } },
    });

    propagation.propagate.mockClear();
    catalogIngredient.findUnique.mockResolvedValue({
      ...TOMATE,
      allergens: ['gluten', 'milk'],
      allergensNone: false,
    });
    await service.update('ing-1', { allergens: ['milk', 'gluten'] }, 'a');
    expect(catalogIngredient.update).toHaveBeenLastCalledWith({
      where: { id: 'ing-1' },
      data: { allergens: ['gluten', 'milk'], allergensNone: false },
      include: { chefProfile: { select: { id: true, displayName: true } } },
    });
    expect(propagation.propagate).not.toHaveBeenCalled();
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
      include: { chefProfile: { select: { id: true, displayName: true } } },
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

  // I1: every signed-in user may search, so a result never carries an author's or a
  // reviewer's user id, the owner profile or the search key.
  it('searches answer the public shape: no user ids, owner or search key', async () => {
    const { catalogIngredient, service } = harness();
    catalogIngredient.findMany.mockResolvedValue([
      {
        ...TOMATE,
        createdByUserId: 'chef-user-9',
        reviewedAt: new Date('2026-11-03T09:00:00.000Z'),
        reviewedByUserId: 'admin-user-1',
      },
      {
        ...TOMATE,
        id: 'p',
        chefProfileId: 'chef-1',
        status: 'pending',
        createdByUserId: 'chef-user-1',
        reviewedAt: null,
        reviewedByUserId: null,
      },
    ]);

    const found = await service.search('tom', 'chef-1');

    for (const row of found) {
      for (const key of [
        'createdByUserId',
        'reviewedByUserId',
        'normalizedName',
        'mergedIntoId',
        'chefProfileId',
      ]) {
        expect(row).not.toHaveProperty(key);
      }
      expect(Object.keys(row).filter((key) => /UserId$/.test(key))).toEqual([]);
    }
    expect(found[0]).toEqual({
      id: 'ing-1',
      name: 'Tomate',
      aliases: ['pomme d’amour'],
      diets: ['vegan', 'vegetarian'],
      seasonMonths: [6, 7, 8, 9],
      aisle: 'fruits-legumes',
      allergens: [],
      allergensNone: true,
      isBasic: false,
      status: 'active',
      mergedInto: null,
      private: false,
      reviewedAt: new Date('2026-11-03T09:00:00.000Z'),
      createdAt: TOMATE.createdAt,
      updatedAt: TOMATE.updatedAt,
    });
    expect(found[1]).toMatchObject({ id: 'p', private: true });
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

// Task 14 carry-over: the console warns about dishes that `failed` and offers a replay.
describe('IngredientsService.update answers the propagation (Recettes §7.3)', () => {
  it('answers the entry with the figures of what was carried', async () => {
    const { propagation, service } = harness();

    const result = await service.update('ing-1', { name: 'Tomate cerise' }, 'admin-1');

    expect(result.ingredient).toMatchObject({ id: 'ing-1', name: 'Tomate cerise' });
    expect(result.propagation).toEqual(await propagation.propagate.mock.results[0].value);
  });

  it('answers a null propagation when nothing was carried', async () => {
    const { service } = harness();
    const result = await service.update('ing-1', { isBasic: true }, 'admin-1');
    expect(result.propagation).toBeNull();
  });

  // Stored lists are canonical (annex order): a legacy order normalized by a save is
  // a change the stamps must follow, unlike a mere reorder of diets or months.
  it('carries a normalization of the allergens order into the stamps', async () => {
    const { catalogIngredient, propagation, service } = harness();
    catalogIngredient.findUnique.mockResolvedValue({
      ...TOMATE,
      allergens: ['milk', 'gluten'],
      allergensNone: false,
    });
    catalogIngredient.update.mockResolvedValue({
      ...TOMATE,
      allergens: ['gluten', 'milk'],
      allergensNone: false,
    } as never);

    await service.update('ing-1', { allergens: ['milk', 'gluten'] }, 'admin-1');

    expect(propagation.propagate).toHaveBeenCalledWith(['ing-1'], {
      type: 'admin',
      userId: 'admin-1',
    });
  });
});

const PENDING = {
  ...TOMATE,
  id: 'p-1',
  name: 'Harissa maison',
  normalizedName: 'harissa maison',
  status: 'pending',
  chefProfileId: 'chef-1',
  createdByUserId: 'user-1',
  reviewedAt: null,
};

describe('IngredientsService.validate (Recettes §7.2)', () => {
  const pending = (catalogIngredient: ReturnType<typeof harness>['catalogIngredient']) =>
    catalogIngredient.findUnique.mockResolvedValue(PENDING);

  it('makes a pending ingredient common, tells its author and journals it', async () => {
    const { catalogIngredient, audit, notifications, propagation, service } = harness();
    pending(catalogIngredient);

    const result = await service.validate('p-1', 'admin-1');

    // Conditioned on the state read: a concurrent change finds nothing to write.
    expect(catalogIngredient.update).toHaveBeenCalledWith({
      where: { id: 'p-1', status: 'pending' },
      data: {
        chefProfileId: null,
        status: 'active',
        reviewedAt: expect.any(Date),
        reviewedByUserId: 'admin-1',
      },
    });
    expect(result.ingredient).toMatchObject({ chefProfileId: null, status: 'active' });
    // Nothing a line copies changes: no propagation.
    expect(result.propagation).toBeNull();
    expect(propagation.propagate).not.toHaveBeenCalled();
    expect(notifications.notify).toHaveBeenCalledWith('user-1', 'ingredient_validated', {
      type: 'catalog_ingredient',
      id: 'p-1',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'admin',
        actorUserId: 'admin-1',
        action: 'catalog_ingredient.validated',
        subjectId: 'p-1',
      }),
    );
  });

  it('answers 409 with the common entry to merge into when one has the name', async () => {
    const { catalogIngredient, notifications, service } = harness();
    pending(catalogIngredient);
    catalogIngredient.findFirst.mockResolvedValue({ id: 'c-1', name: 'Harissa' });

    const error = await service.validate('p-1', 'admin-1').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'INGREDIENT_ALREADY_LISTED',
      ingredient: { id: 'c-1', name: 'Harissa' },
    });
    expect(catalogIngredient.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          normalizedName: 'harissa maison',
          chefProfileId: null,
          status: { not: 'merged' },
        }),
      }),
    );
    expect(catalogIngredient.update).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('answers 409 when the unique index answered first (a race)', async () => {
    const { catalogIngredient, service } = harness();
    pending(catalogIngredient);
    catalogIngredient.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    );
    await expect(service.validate('p-1', 'admin-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it.each([['active'], ['inactive'], ['merged']])(
    'answers 422 for an entry that is %s',
    async (status) => {
      const { catalogIngredient, notifications, service } = harness();
      catalogIngredient.findUnique.mockResolvedValue({ ...PENDING, status });
      await expect(service.validate('p-1', 'admin-1')).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(catalogIngredient.update).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    },
  );

  // The chef or another admin changed the entry between the read and the write.
  it('answers 422 when the entry stopped being pending meanwhile', async () => {
    const { catalogIngredient, notifications, service } = harness();
    pending(catalogIngredient);
    catalogIngredient.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('gone', {
        code: 'P2025',
        clientVersion: 'x',
      }),
    );
    await expect(service.validate('p-1', 'admin-1')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('stays validated when the notification fails', async () => {
    const { catalogIngredient, notifications, service } = harness();
    pending(catalogIngredient);
    notifications.notify.mockRejectedValue(new Error('db down'));
    await expect(service.validate('p-1', 'admin-1')).resolves.toMatchObject({
      ingredient: { status: 'active' },
    });
  });

  it('answers 404 for an unknown ingredient', async () => {
    const { catalogIngredient, service } = harness();
    catalogIngredient.findUnique.mockResolvedValue(null);
    await expect(service.validate('nope', 'admin-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('tells nobody when the entry has no author', async () => {
    const { catalogIngredient, notifications, service } = harness();
    catalogIngredient.findUnique.mockResolvedValue({ ...PENDING, createdByUserId: null });
    await service.validate('p-1', 'admin-1');
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});

describe('IngredientsService.merge (Recettes §7.2)', () => {
  const rows = (
    catalogIngredient: ReturnType<typeof harness>['catalogIngredient'],
    target: object | null = TOMATE,
  ) =>
    catalogIngredient.findUnique.mockImplementation(async (args) => {
      const id = (args as { where: { id: string } }).where.id;
      return id === 'p-1' ? PENDING : id === 'ing-1' ? target : null;
    });

  it('merges a pending ingredient into a common one and carries it into the recipes', async () => {
    const { catalogIngredient, audit, notifications, propagation, service } = harness();
    rows(catalogIngredient);

    const result = await service.merge('p-1', 'ing-1', 'admin-1');

    expect(catalogIngredient.update).toHaveBeenCalledWith({
      where: { id: 'p-1', status: 'pending' },
      data: {
        status: 'merged',
        mergedIntoId: 'ing-1',
        reviewedAt: expect.any(Date),
        reviewedByUserId: 'admin-1',
      },
      include: { chefProfile: { select: { id: true, displayName: true } } },
    });
    expect(result.ingredient).toMatchObject({ status: 'merged', mergedIntoId: 'ing-1' });
    expect(propagation.propagate).toHaveBeenCalledWith(
      ['ing-1'],
      { type: 'admin', userId: 'admin-1' },
      { from: 'p-1', to: 'ing-1' },
    );
    expect(result.propagation).toEqual({
      dishes: 2,
      reverified: 1,
      chefs: 1,
      skipped: 0,
      failed: 0,
    });
    expect(notifications.notify).toHaveBeenCalledWith('user-1', 'ingredient_merged', {
      type: 'catalog_ingredient',
      id: 'p-1',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'catalog_ingredient.merged',
        subjectId: 'p-1',
        metadata: expect.objectContaining({ intoId: 'ing-1' }),
      }),
    );
  });

  it.each([
    ['an inactive common entry', { status: 'inactive' }],
    ['a merged entry', { status: 'merged' }],
    ['a pending entry', { status: 'pending' }],
    ['a chef private entry', { chefProfileId: 'chef-2' }],
    ['an unknown entry', null],
  ])('answers 422 when the target is %s', async (_label, over) => {
    const { catalogIngredient, notifications, propagation, service } = harness();
    rows(catalogIngredient, over && { ...TOMATE, ...over });

    await expect(service.merge('p-1', 'ing-1', 'admin-1')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(catalogIngredient.update).not.toHaveBeenCalled();
    expect(propagation.propagate).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('answers 422 and carries nothing when the source stopped being pending meanwhile', async () => {
    const { catalogIngredient, notifications, propagation, service } = harness();
    rows(catalogIngredient);
    catalogIngredient.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('gone', {
        code: 'P2025',
        clientVersion: 'x',
      }),
    );
    await expect(service.merge('p-1', 'ing-1', 'admin-1')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(propagation.propagate).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('stays merged, with its figures, when the notification fails', async () => {
    const { catalogIngredient, notifications, service } = harness();
    rows(catalogIngredient);
    notifications.notify.mockRejectedValue(new Error('db down'));
    await expect(service.merge('p-1', 'ing-1', 'admin-1')).resolves.toMatchObject({
      ingredient: { status: 'merged' },
      propagation: { dishes: 2 },
    });
  });

  it.each([['active'], ['merged'], ['inactive']])(
    'answers 422 when the source is %s',
    async (status) => {
      const { catalogIngredient, propagation, service } = harness();
      catalogIngredient.findUnique.mockImplementation(async (args) =>
        (args as { where: { id: string } }).where.id === 'p-1'
          ? { ...PENDING, status }
          : TOMATE,
      );
      await expect(service.merge('p-1', 'ing-1', 'admin-1')).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(propagation.propagate).not.toHaveBeenCalled();
    },
  );

  it('answers 404 for an unknown source, and 422 for a merge into itself', async () => {
    const { catalogIngredient, service } = harness();
    catalogIngredient.findUnique.mockResolvedValue(null);
    await expect(service.merge('nope', 'ing-1', 'admin-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    rows(catalogIngredient);
    await expect(service.merge('p-1', 'p-1', 'admin-1')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });
});

// Recettes §4.10 / Review Focus: a private ingredient is its chef's alone.
describe('IngredientsService.search keeps private ingredients private', () => {
  it("never shows a chef another chef's pending ingredient", async () => {
    const { catalogIngredient, service } = harness();
    const table = [
      TOMATE,
      { ...TOMATE, id: 'mine', chefProfileId: 'chef-1', status: 'pending' },
      { ...TOMATE, id: 'theirs', chefProfileId: 'chef-2', status: 'pending' },
      { ...TOMATE, id: 'old', chefProfileId: 'chef-2', status: 'merged' },
    ];
    // Applies the visibility clause of the query to the table, as the database would.
    catalogIngredient.findMany.mockImplementation(async (args) => {
      const visible = (
        args as {
          where: {
            AND: [{ OR: { chefProfileId: string | null; status: string }[] }];
          };
        }
      ).where.AND[0].OR;
      return table.filter((row) =>
        visible.some(
          (v) => v.chefProfileId === row.chefProfileId && v.status === row.status,
        ),
      );
    });

    const ids = async (chefProfileId: string | null) =>
      (await service.search('tom', chefProfileId)).map((row) => row.id);

    expect(await ids('chef-1')).toEqual(['ing-1', 'mine']);
    expect(await ids('chef-2')).toEqual(['ing-1', 'theirs']);
    expect(await ids(null)).toEqual(['ing-1']);
  });
});

// Ruling R25: the validation queue shows each private entry's chef and its dishes.
describe('IngredientsService chef and dishes (ruling R25)', () => {
  const CHEF = { id: 'chef-1', displayName: 'Chez Marie' };
  const PRIVATE = {
    ...TOMATE,
    id: 'p-1',
    chefProfileId: 'chef-1',
    status: 'pending',
    chefProfile: { ...CHEF, user: { email: 'secret@x.fr' } },
  };

  it('lists with the chef in the same query, null for a common entry', async () => {
    const { catalogIngredient, service } = harness();
    catalogIngredient.findMany.mockResolvedValue([PRIVATE, TOMATE]);

    const page = await service.list({ page: 1, limit: 50 });

    expect(catalogIngredient.findMany).toHaveBeenCalledTimes(1);
    expect(catalogIngredient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { chefProfile: { select: { id: true, displayName: true } } },
      }),
    );
    expect(page.data[0].chef).toEqual(CHEF);
    expect(page.data[1].chef).toBeNull();
    expect(JSON.stringify(page.data)).not.toContain('secret@x.fr');
    expect(page.data[0]).not.toHaveProperty('chefProfile');
  });

  it('answers the chef on update and merge, null on create and validate', async () => {
    const { catalogIngredient, service } = harness();
    catalogIngredient.update.mockResolvedValue(PRIVATE as never);
    catalogIngredient.findUnique.mockResolvedValue({
      ...PRIVATE,
      createdByUserId: null,
    });

    const updated = await service.update('p-1', { name: 'Tomate' }, 'admin-1');
    expect(updated.ingredient.chef).toEqual(CHEF);
    expect(catalogIngredient.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        include: { chefProfile: { select: { id: true, displayName: true } } },
      }),
    );

    catalogIngredient.findUnique
      .mockResolvedValueOnce({ ...PRIVATE, createdByUserId: null })
      .mockResolvedValueOnce({ id: 'ing-1', status: 'active', chefProfileId: null });
    const merged = await service.merge('p-1', 'ing-1', 'admin-1');
    expect(merged.ingredient.chef).toEqual(CHEF);
    expect(JSON.stringify(merged)).not.toContain('secret@x.fr');

    catalogIngredient.update.mockResolvedValue(TOMATE);
    const created = await service.create({ name: 'Tomate' }, 'admin-1');
    expect(created.chef).toBeNull();
    catalogIngredient.findUnique.mockResolvedValue({
      ...PRIVATE,
      createdByUserId: null,
    });
    const validated = await service.validate('p-1', 'admin-1');
    expect(validated.ingredient.chef).toBeNull();
  });

  describe('dishes', () => {
    const dish = (id: string, name: string, chef: typeof CHEF | null) => ({
      id,
      name,
      status: 'published',
      allergensVerifiedAt: chef ? new Date('2026-11-01T00:00:00.000Z') : null,
      chefProfile: chef,
    });

    it('lists the dishes of two chefs and a Lab’s Food recipe, merged entries included', async () => {
      const { catalogIngredient, meal, service } = harness();
      catalogIngredient.findMany.mockResolvedValue([{ id: 'ing-old' }]);
      meal.count.mockResolvedValue(3);
      meal.findMany.mockResolvedValue([
        dish('d-1', 'Curry', CHEF),
        dish('d-2', 'Ratatouille', { id: 'chef-2', displayName: 'Chez Paul' }),
        dish('d-3', 'Soupe', null),
      ]);

      const result = await service.dishes('ing-1');

      expect(meal.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { ingredients: { array_contains: [{ catalogIngredientId: 'ing-1' }] } },
            { ingredients: { array_contains: [{ catalogIngredientId: 'ing-old' }] } },
          ],
        },
        select: {
          id: true,
          name: true,
          status: true,
          allergensVerifiedAt: true,
          chefProfile: { select: { id: true, displayName: true } },
        },
        orderBy: { name: 'asc' },
        take: 200,
      });
      expect(result.total).toBe(3);
      expect(result.data).toEqual([
        {
          id: 'd-1',
          name: 'Curry',
          chef: CHEF,
          status: 'published',
          allergensVerifiedAt: new Date('2026-11-01T00:00:00.000Z'),
        },
        expect.objectContaining({
          id: 'd-2',
          chef: { id: 'chef-2', displayName: 'Chez Paul' },
        }),
        {
          id: 'd-3',
          name: 'Soupe',
          chef: null,
          status: 'published',
          allergensVerifiedAt: null,
        },
      ]);
    });

    it('caps at 200 and counts the whole', async () => {
      const { meal, service } = harness();
      meal.findMany.mockResolvedValue(
        Array.from({ length: 200 }, (_, i) => dish(`d-${i}`, `D${i}`, CHEF)),
      );
      meal.count.mockResolvedValue(350);

      const result = await service.dishes('ing-1');

      expect(result.data).toHaveLength(200);
      expect(result.total).toBe(350);
    });

    it('answers 404 for an unknown ingredient', async () => {
      const { catalogIngredient, meal, service } = harness();
      catalogIngredient.findUnique.mockResolvedValue(null);

      await expect(service.dishes('nope')).rejects.toBeInstanceOf(NotFoundException);
      expect(meal.findMany).not.toHaveBeenCalled();
    });
  });
});
