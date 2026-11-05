import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ChefContentService } from '../dishes/chef-content.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ChefIngredientsService } from './chef-ingredients.service';
import { IngredientPropagationService } from './ingredient-propagation.service';
import { IngredientsService } from './ingredients.service';

const CHEF = { id: 'chef-1', userId: 'user-1', isVerified: true };

const MINE = {
  id: 'ing-1',
  name: 'Harissa maison',
  normalizedName: 'harissa maison',
  aliases: [],
  diets: [],
  seasonMonths: [],
  aisle: 'epices',
  allergens: ['mustard'],
  allergensNone: false,
  isBasic: false,
  status: 'pending',
  chefProfileId: 'chef-1',
  createdByUserId: 'user-1',
  mergedIntoId: null,
};

const VALID = { name: ' Harissa maison ', aisle: 'epices', allergens: ['mustard'] };

function harness() {
  const catalogIngredient = {
    findFirst: jest.fn(async (_args?: unknown): Promise<unknown> => null),
    findMany: jest.fn(async (_args?: unknown): Promise<unknown[]> => [MINE]),
    findUnique: jest.fn(async (_args?: unknown): Promise<unknown> => MINE),
    count: jest.fn(async (_args?: unknown) => 0),
    create: jest.fn(async ({ data }: { data: object }) => ({ ...MINE, ...data })),
    update: jest.fn(async ({ data }: { data: object }) => ({ ...MINE, ...data })),
  };
  const prisma = {
    catalogIngredient,
    platformSetting: { findUnique: jest.fn(async (_args?: unknown) => null) },
  } as unknown as PrismaService;
  const propagation = {
    propagate: jest.fn(async (..._args: unknown[]) => ({
      dishes: 1,
      reverified: 0,
      chefs: 0,
      skipped: 0,
      failed: 0,
    })),
  };
  const chefs = {
    chef: jest.fn(async (_id: string) => CHEF),
    assertVerified: jest.fn((_chef: unknown) => undefined),
  };
  const ingredients = new IngredientsService(
    prisma,
    { record: jest.fn() } as unknown as AuditService,
    propagation as unknown as IngredientPropagationService,
    { notify: jest.fn() } as unknown as NotificationsService,
  );
  const service = new ChefIngredientsService(
    prisma,
    chefs as unknown as ChefContentService,
    ingredients,
    propagation as unknown as IngredientPropagationService,
  );
  return { catalogIngredient, propagation, chefs, service };
}

const response = (error: unknown) =>
  (error as { getResponse: () => Record<string, unknown> }).getResponse();

describe('ChefIngredientsService.create (Recettes §7.1)', () => {
  it('stores a pending ingredient that carries its chef', async () => {
    const { catalogIngredient, service } = harness();

    const row = await service.create('clerk-1', VALID);

    expect(catalogIngredient.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Harissa maison',
        normalizedName: 'harissa maison',
        aisle: 'epices',
        allergens: ['mustard'],
        allergensNone: false,
        status: 'pending',
        chefProfileId: 'chef-1',
        createdByUserId: 'user-1',
      }),
    });
    expect(row).toMatchObject({ status: 'pending', chefProfileId: 'chef-1' });
  });

  it('needs a verified chef', async () => {
    const { catalogIngredient, chefs, service } = harness();
    chefs.assertVerified.mockImplementation(() => {
      throw new ForbiddenException();
    });
    await expect(service.create('clerk-1', VALID)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(catalogIngredient.create).not.toHaveBeenCalled();
  });

  it.each([
    ['neither allergens nor "none"', { allergens: undefined }],
    ['an empty allergen list and no "none"', { allergens: [] }],
    ['"none" false and no allergen', { allergens: undefined, allergensNone: false }],
  ])('refuses %s with 400', async (_label, over) => {
    const { catalogIngredient, service } = harness();
    const error = await service
      .create('clerk-1', { ...VALID, ...over })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(catalogIngredient.create).not.toHaveBeenCalled();
  });

  it('accepts "none" in place of allergens', async () => {
    const { catalogIngredient, service } = harness();
    await service.create('clerk-1', {
      ...VALID,
      allergens: undefined,
      allergensNone: true,
    });
    expect(catalogIngredient.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ allergens: [], allergensNone: true }),
    });
  });

  it('refuses allergens together with "none", and an unknown aisle', async () => {
    const { service } = harness();
    await expect(
      service.create('clerk-1', { ...VALID, allergensNone: true }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      service.create('clerk-1', { ...VALID, aisle: 'nowhere' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('answers 409 with the common entry of the same name, accents folded', async () => {
    const { catalogIngredient, service } = harness();
    catalogIngredient.findFirst.mockResolvedValueOnce({ id: 'c-1', name: 'Crème' });

    const error = await service
      .create('clerk-1', { ...VALID, name: 'CREME' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(response(error)).toMatchObject({
      code: 'INGREDIENT_ALREADY_LISTED',
      ingredient: { id: 'c-1', name: 'Crème' },
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
    expect(catalogIngredient.create).not.toHaveBeenCalled();
  });

  it('answers 409 when the name is another name of a common entry', async () => {
    const { catalogIngredient, service } = harness();
    // The name lookups find nothing; the alias lookup finds Tomate.
    catalogIngredient.findFirst.mockImplementation(async (args) => {
      const where = (args as { where: { aliases?: unknown } }).where;
      return where.aliases ? { id: 'c-2', name: 'Tomate' } : null;
    });

    const error = await service
      .create('clerk-1', { ...VALID, name: 'Pomme d’Amour' })
      .catch((e: unknown) => e);

    expect(response(error)).toMatchObject({
      code: 'INGREDIENT_ALREADY_LISTED',
      ingredient: { id: 'c-2', name: 'Tomate' },
    });
    expect(catalogIngredient.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          chefProfileId: null,
          status: { not: 'merged' },
          aliases: { hasSome: expect.arrayContaining(['pomme d’amour']) },
        }),
      }),
    );
  });

  it('answers 409 when the chef already has the name pending', async () => {
    const { catalogIngredient, service } = harness();
    catalogIngredient.findFirst.mockImplementation(async (args) => {
      const where = (args as { where: { chefProfileId?: unknown; status?: unknown } })
        .where;
      return where.chefProfileId === 'chef-1' && where.status === 'pending'
        ? { id: 'ing-0', name: 'Harissa Maison' }
        : null;
    });

    const error = await service.create('clerk-1', VALID).catch((e: unknown) => e);

    expect(response(error)).toMatchObject({
      code: 'INGREDIENT_ALREADY_LISTED',
      ingredient: { id: 'ing-0', name: 'Harissa Maison' },
    });
  });

  it('answers 409 when the unique index answered first (a race)', async () => {
    const { catalogIngredient, service } = harness();
    catalogIngredient.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    );
    await expect(service.create('clerk-1', VALID)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('allows the 50th creation of the last 24 hours and refuses the 51st with 429', async () => {
    const { catalogIngredient, service } = harness();
    catalogIngredient.count.mockResolvedValue(49);
    await expect(service.create('clerk-1', VALID)).resolves.toBeDefined();

    catalogIngredient.count.mockResolvedValue(50);
    const error = await service.create('clerk-1', VALID).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 429 });
    expect(response(error)).toMatchObject({ code: 'INGREDIENT_CAP_REACHED' });

    const where = (
      catalogIngredient.count.mock.calls[0][0] as {
        where: { createdByUserId: string; createdAt: { gt: Date } };
      }
    ).where;
    expect(where.createdByUserId).toBe('user-1');
    const age = Date.now() - where.createdAt.gt.getTime();
    expect(age).toBeGreaterThan(24 * 3600_000 - 5_000);
    expect(age).toBeLessThan(24 * 3600_000 + 5_000);
  });
});

describe('ChefIngredientsService.listMine (Recettes §7.1)', () => {
  it('lists what the chef created, whatever the status, with the merge target', async () => {
    const { catalogIngredient, service } = harness();
    catalogIngredient.findMany.mockResolvedValue([
      MINE,
      {
        ...MINE,
        id: 'ing-2',
        status: 'merged',
        mergedInto: { id: 'c-1', name: 'Harissa' },
      },
      { ...MINE, id: 'ing-3', status: 'active', chefProfileId: null },
    ]);

    const rows = await service.listMine('clerk-1');

    expect(catalogIngredient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { createdByUserId: 'user-1' },
        include: { mergedInto: { select: { id: true, name: true } } },
      }),
    );
    expect(rows.map((r) => [r.id, r.status])).toEqual([
      ['ing-1', 'pending'],
      ['ing-2', 'merged'],
      ['ing-3', 'active'],
    ]);
    expect(rows[1].mergedInto).toEqual({ id: 'c-1', name: 'Harissa' });
    expect(rows[0].mergedInto).toBeNull();
  });
});

describe('ChefIngredientsService.update (Recettes §7.1)', () => {
  it('changes a pending ingredient of the chef and carries it into their dishes', async () => {
    const { catalogIngredient, propagation, service } = harness();

    await service.update('clerk-1', 'ing-1', { allergens: ['mustard', 'gluten'] });

    expect(catalogIngredient.update).toHaveBeenCalledWith({
      where: { id: 'ing-1' },
      data: { allergens: ['gluten', 'mustard'], allergensNone: false },
    });
    expect(propagation.propagate).toHaveBeenCalledWith(['ing-1'], {
      type: 'chef',
      userId: 'user-1',
    });
  });

  it('carries nothing for a change that no recipe line copies', async () => {
    const { propagation, service } = harness();
    await service.update('clerk-1', 'ing-1', { aliases: ['harissa'], isBasic: true });
    expect(propagation.propagate).not.toHaveBeenCalled();
  });

  it('answers 404 for another chef’s ingredient, and for an unknown one', async () => {
    const { catalogIngredient, propagation, service } = harness();
    catalogIngredient.findUnique.mockResolvedValue({
      ...MINE,
      chefProfileId: 'chef-2',
      createdByUserId: 'user-2',
    });
    await expect(
      service.update('clerk-1', 'ing-1', { name: 'Autre' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    catalogIngredient.findUnique.mockResolvedValue(null);
    await expect(
      service.update('clerk-1', 'nope', { name: 'Autre' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(catalogIngredient.update).not.toHaveBeenCalled();
    expect(propagation.propagate).not.toHaveBeenCalled();
  });

  it.each([
    ['validated (now common)', { status: 'active', chefProfileId: null }],
    ['merged', { status: 'merged', mergedIntoId: 'c-1' }],
  ])('answers 422 for an own ingredient already %s', async (_label, over) => {
    const { catalogIngredient, propagation, service } = harness();
    catalogIngredient.findUnique.mockResolvedValue({ ...MINE, ...over });

    await expect(
      service.update('clerk-1', 'ing-1', { name: 'Autre' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(catalogIngredient.update).not.toHaveBeenCalled();
    expect(propagation.propagate).not.toHaveBeenCalled();
  });

  it('refuses a new name already in the common list, but not its own name', async () => {
    const { catalogIngredient, service } = harness();
    catalogIngredient.findFirst.mockResolvedValueOnce({ id: 'c-1', name: 'Crème' });
    await expect(
      service.update('clerk-1', 'ing-1', { name: 'Crème' }),
    ).rejects.toBeInstanceOf(ConflictException);

    await service.update('clerk-1', 'ing-1', { name: 'Harissa maison' });
    // The own-pending lookup leaves the ingredient itself out.
    expect(catalogIngredient.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          chefProfileId: 'chef-1',
          status: 'pending',
          id: { not: 'ing-1' },
        }),
      }),
    );
  });

  it('refuses allergens together with "none"', async () => {
    const { service } = harness();
    await expect(
      service.update('clerk-1', 'ing-1', { allergens: ['gluten'], allergensNone: true }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
