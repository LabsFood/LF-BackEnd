import { ConflictException } from '@nestjs/common';

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
  const audit = { record: jest.fn(async (_entry: object) => undefined) };
  const service = new IngredientsService(
    { catalogIngredient, meal } as unknown as PrismaService,
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
      { id: 'dish-1', ingredients: [{ name: 'Tomate', catalogIngredientId: 'ing-1' }] },
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
});
