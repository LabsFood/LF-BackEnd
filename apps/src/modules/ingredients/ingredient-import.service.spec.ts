import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { IngredientImportService } from './ingredient-import.service';
import { IngredientPropagationService } from './ingredient-propagation.service';
import { IngredientsService } from './ingredients.service';

const HEADER = 'nom;autres_noms;rayon;allergenes;aucun_allergene;regimes;mois;base;doute';
const csv = (...lines: string[]) => [HEADER, ...lines].join('\n');

const FIGURES = { dishes: 2, reverified: 1, chefs: 1, skipped: 0, failed: 0 };

function harness(existing: Record<string, unknown>[] = []) {
  const stored = existing.map((row) => ({ ...row }));
  const catalogIngredient = {
    findMany: jest.fn(async (_args?: unknown) => stored),
    findFirst: jest.fn(async (_args?: unknown): Promise<unknown> => null),
    // A copy: the stored row is mutated by update, `before` must stay as it was.
    findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
      const row = stored.find((r) => r.id === where.id);
      return row && { ...row };
    }),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = {
        id: `new-${stored.length}`,
        chefProfileId: null,
        status: 'active',
        ...data,
      };
      stored.push(row);
      return row;
    }),
    update: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = stored.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return { ...row };
      },
    ),
  };
  const platformSetting = { findUnique: jest.fn(async (_args?: unknown) => null) };
  const audit = { record: jest.fn(async (_entry: object) => undefined) };
  const propagation = { propagate: jest.fn(async (..._args: unknown[]) => FIGURES) };
  const prisma = { catalogIngredient, platformSetting } as unknown as PrismaService;
  const ingredients = new IngredientsService(
    prisma,
    audit as unknown as AuditService,
    propagation as unknown as IngredientPropagationService,
    {} as NotificationsService,
  );
  const service = new IngredientImportService(
    prisma,
    ingredients,
    audit as unknown as AuditService,
  );
  return { catalogIngredient, audit, propagation, service, stored };
}

const TOMATE = {
  id: 'ing-1',
  name: 'Tomate',
  normalizedName: 'tomate',
  aliases: [],
  diets: ['vegetarian', 'no-pork', 'pescetarian'],
  seasonMonths: [],
  aisle: 'fruits-legumes',
  allergens: [],
  allergensNone: true,
  isBasic: false,
  status: 'active',
  chefProfileId: null,
};

describe('IngredientImportService (Recettes §7.4)', () => {
  it('without confirm, simulates and writes nothing', async () => {
    const { catalogIngredient, audit, service } = harness([TOMATE]);
    const result = await service.run(
      csv('Tomate;;fruits-legumes;;oui;vegan;;non;', 'Pain;;boulangerie;gluten;;;;;'),
      { confirm: false },
      'admin-1',
    );
    expect(result).toMatchObject({ created: 1, updated: 1, unchanged: 0, errors: [] });
    expect(catalogIngredient.create).not.toHaveBeenCalled();
    expect(catalogIngredient.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('with errors, writes nothing even with confirm, but still reports the simulation', async () => {
    const { catalogIngredient, audit, service } = harness();
    const result = await service.run(
      csv('Pain;;boulangerie;gluten;;;;;', 'Mystère;;cave;;oui;;;;'),
      { confirm: true },
      'admin-1',
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].line).toBe(3);
    expect(result.created).toBe(1);
    expect(catalogIngredient.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('with confirm creates common active entries, journaled once with the counts', async () => {
    const { catalogIngredient, audit, service } = harness();
    const result = await service.run(
      csv('Pain;;boulangerie;gluten;;;;;', 'Sel;;epicerie-salee;;oui;;;oui;'),
      { confirm: true },
      'admin-1',
    );
    expect(result).toMatchObject({ created: 2, updated: 0, unchanged: 0, errors: [] });
    expect(catalogIngredient.create).toHaveBeenCalledTimes(2);
    const imported = audit.record.mock.calls.filter(
      ([e]) => (e as { action: string }).action === 'catalog_ingredient.imported',
    );
    expect(imported).toHaveLength(1);
    expect(imported[0][0]).toMatchObject({
      actorType: 'admin',
      actorUserId: 'admin-1',
      metadata: { created: 2, updated: 0, unchanged: 0 },
    });
  });

  it('an update of an existing entry carries it (propagate) and sums the figures', async () => {
    const { catalogIngredient, propagation, service } = harness([TOMATE]);
    const result = await service.run(
      csv('tomate;;fruits-legumes;gluten;;vegetarian;;non;'),
      { confirm: true },
      'admin-1',
    );
    expect(result).toMatchObject({ created: 0, updated: 1, unchanged: 0 });
    expect(catalogIngredient.update).toHaveBeenCalledTimes(1);
    expect(propagation.propagate).toHaveBeenCalledWith(['ing-1'], {
      type: 'admin',
      userId: 'admin-1',
    });
    expect(result.propagation).toEqual(FIGURES);
  });

  it('replaying the same file after an import leaves everything unchanged, no write', async () => {
    const { catalogIngredient, propagation, service } = harness();
    const file = csv(
      'Tomate;pomme d’amour;fruits-legumes;;oui;vegan;7|6;non;',
      'Pain;;boulangerie;gluten;;;;;',
    );
    await service.run(file, { confirm: true }, 'admin-1');
    catalogIngredient.create.mockClear();
    const again = await service.run(file, { confirm: true }, 'admin-1');
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 2, errors: [] });
    expect(catalogIngredient.create).not.toHaveBeenCalled();
    expect(catalogIngredient.update).not.toHaveBeenCalled();
    expect(propagation.propagate).not.toHaveBeenCalled();
  });

  it('stops at the first failed write, answering what was done and the error', async () => {
    const { catalogIngredient, audit, service } = harness();
    catalogIngredient.create
      .mockImplementationOnce(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'n-0',
        chefProfileId: null,
        status: 'active',
        ...data,
      }))
      .mockRejectedValueOnce(new Error('db down'));
    const result = await service.run(
      csv(
        'A;;epicerie-salee;;oui;;;;',
        'B;;epicerie-salee;;oui;;;;',
        'C;;epicerie-salee;;oui;;;;',
      ),
      { confirm: true },
      'admin-1',
    );
    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('B');
    expect(catalogIngredient.create).toHaveBeenCalledTimes(2);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'catalog_ingredient.imported',
        metadata: expect.objectContaining({ created: 1 }),
      }),
    );
  });

  it('matches only common, non-merged entries', async () => {
    const { catalogIngredient, service } = harness();
    await service.run(
      csv('Pain;;boulangerie;gluten;;;;;'),
      { confirm: false },
      'admin-1',
    );
    expect(catalogIngredient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          chefProfileId: null,
          status: { not: 'merged' },
        }),
      }),
    );
  });
});
