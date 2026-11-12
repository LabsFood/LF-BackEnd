import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ambiguousKeys, matchIndex } from '../dishes/domain/reprise.rules';
import { NotificationsService } from '../notifications/notifications.service';
import { IngredientImportService } from './ingredient-import.service';
import { IngredientPropagationService } from './ingredient-propagation.service';
import { IngredientsService } from './ingredients.service';

const HEADER = 'nom;autres_noms;rayon;allergenes;aucun_allergene;regimes;mois;base;doute';
const csv = (...lines: string[]) => [HEADER, ...lines].join('\n');

const FIGURES = { dishes: 2, reverified: 1, chefs: 1, skipped: 0, failed: 0 };

type Where = Record<string, unknown> & { OR?: Where[] };

/** The few `where` shapes the import and the name check use, as the database applies them. */
function matches(row: Record<string, unknown>, where: Where = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') return (condition as Where[]).some((w) => matches(row, w));
    const value = row[key] ?? null;
    if (condition === null || typeof condition !== 'object') return value === condition;
    const c = condition as { in?: unknown[]; not?: unknown };
    if (c.in) return c.in.includes(value);
    if ('not' in c) return value !== c.not;
    return true;
  });
}

function harness(existing: Record<string, unknown>[] = []) {
  const stored = existing.map((row) => ({ ...row }));
  const catalogIngredient = {
    findMany: jest.fn(async (args?: unknown) =>
      stored.filter((row) => matches(row, (args as { where?: Where })?.where)),
    ),
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
    // Ruling R25: a simulation wrote nothing, so it updated no id.
    expect(result.updatedIds).toEqual([]);
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
    // Ruling R25: the console replays the propagation for these ids when `failed > 0`.
    expect(result.updatedIds).toEqual(['ing-1']);
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

// I2: the go-live order imports before the reprise fills normalized_name. A lot 2 entry
// (key still NULL) of the row's name is updated in place, never duplicated.
describe('IngredientImportService and lot 2 entries (I2)', () => {
  const LEGACY = {
    ...TOMATE,
    id: 'legacy-1',
    name: 'Tomate',
    normalizedName: null,
    // Lot 2 rows are "à compléter" after the migration.
    aisle: null,
    allergens: [],
    allergensNone: false,
  };

  it('updates the legacy entry, fills its key, and the reprise then sees one « tomate »', async () => {
    const { catalogIngredient, service, stored } = harness([LEGACY]);

    const result = await service.run(
      csv('Tomate;;fruits-legumes;;oui;vegan;;non;'),
      { confirm: true },
      'admin-1',
    );

    expect(result).toMatchObject({ created: 0, updated: 1, unchanged: 0, errors: [] });
    expect(result.updatedIds).toEqual(['legacy-1']);
    expect(catalogIngredient.create).not.toHaveBeenCalled();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: 'legacy-1',
      normalizedName: 'tomate',
      aisle: 'fruits-legumes',
      allergensNone: true,
    });
    // The plan asked for the NULL keys too.
    expect(catalogIngredient.findMany.mock.calls[0][0]).toMatchObject({
      where: {
        chefProfileId: null,
        status: { not: 'merged' },
        OR: [{ normalizedName: { in: ['tomate'] } }, { normalizedName: null }],
      },
    });
    // The reprise's index, built from the active common entries.
    const entries = stored
      .filter((row) => row.chefProfileId === null && row.status === 'active')
      .map((row) => ({
        id: row.id as string,
        name: row.name as string,
        aliases: row.aliases as string[],
      }));
    expect(ambiguousKeys(entries)).toEqual([]);
    expect(matchIndex(entries).get('tomate')).toBe('legacy-1');
  });

  it('matches accents and case; a legacy entry the row leaves as it is still gets its key', async () => {
    const legacy = {
      ...TOMATE,
      id: 'legacy-2',
      name: 'Crème fraîche',
      normalizedName: null,
      aisle: 'cremerie',
      allergens: ['milk'],
      allergensNone: false,
      diets: ['vegetarian', 'no-pork', 'pescetarian'],
    };
    const { service, stored } = harness([legacy]);
    const file = csv('creme FRAICHE;;cremerie;milk;;vegetarian;;non;');

    const simulated = await service.run(file, { confirm: false }, 'admin-1');
    // Nothing else may differ but the name's case: writing the key is the update.
    expect(simulated).toMatchObject({ created: 0, updated: 1, unchanged: 0 });

    await service.run(file, { confirm: true }, 'admin-1');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: 'legacy-2', normalizedName: 'creme fraiche' });

    // Its key is stored now: the same file again changes nothing.
    const again = await service.run(file, { confirm: false }, 'admin-1');
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
  });

  it('a legacy entry identical to its row is still written, for its key', async () => {
    const { service, stored } = harness([
      { ...TOMATE, id: 'legacy-3', normalizedName: null },
    ]);
    const file = csv('Tomate;;fruits-legumes;;oui;vegetarian;;non;');

    const result = await service.run(file, { confirm: true }, 'admin-1');

    expect(result).toMatchObject({ created: 0, updated: 1, unchanged: 0 });
    expect(stored[0]).toMatchObject({ id: 'legacy-3', normalizedName: 'tomate' });
  });

  it('a stored key wins over a legacy entry of the same name', async () => {
    const { catalogIngredient, service } = harness([
      { ...LEGACY, id: 'legacy-1' },
      { ...TOMATE, id: 'ing-1' },
    ]);

    await service.run(
      csv('Tomate;;fruits-legumes;gluten;;;;non;'),
      { confirm: true },
      'admin-1',
    );

    expect(catalogIngredient.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ing-1' } }),
    );
  });
});
