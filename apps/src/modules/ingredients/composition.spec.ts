import { PrismaService } from '../../prisma/prisma.service';
import { LineInput } from '../dishes/domain/recipe-lines.rules';
import {
  assertIngredientAccess,
  compositionOf,
  entriesFor,
  EntryRow,
  stampLines,
} from './composition';

const entry = (over: Partial<EntryRow> & { id: string }): EntryRow => ({
  name: 'Tomate',
  aisle: 'fruits_legumes',
  allergens: [],
  allergensNone: true,
  isBasic: false,
  diets: ['vegan'],
  seasonMonths: [],
  status: 'active',
  chefProfileId: null,
  mergedIntoId: null,
  ...over,
});

const line = (over: Partial<LineInput> = {}): LineInput => ({
  name: 'tomates',
  qty: 2,
  unit: 'kg',
  aisle: null,
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
  ...over,
});

const mapOf = (...rows: EntryRow[]) => new Map(rows.map((r) => [r.id, r]));

function db(rows: EntryRow[]) {
  const findMany = jest.fn(
    async (args: { where: { id: { in: string[] } } }): Promise<EntryRow[]> =>
      rows.filter((r) => args.where.id.in.includes(r.id)),
  );
  return {
    findMany,
    db: { catalogIngredient: { findMany } } as unknown as PrismaService,
  };
}

describe('stampLines (Recettes §4.10 / §5.2)', () => {
  it('copies name, aisle and allergens of the entry, and flags an incomplete one', () => {
    const complete = entry({ id: 'a', allergens: ['gluten'], allergensNone: false });
    const incomplete = entry({ id: 'b', name: 'Pâte', aisle: null, allergens: ['egg'] });
    const [one, two] = stampLines(
      [line({ catalogIngredientId: 'a' }), line({ catalogIngredientId: 'b' })],
      mapOf(complete, incomplete),
    );
    expect(one).toMatchObject({
      name: 'Tomate',
      aisle: 'fruits_legumes',
      allergens: ['gluten'],
      incomplete: false,
    });
    expect(two).toMatchObject({ aisle: null, allergens: ['egg'], incomplete: true });
  });

  it('takes isBasic when hiddenFromClient is absent, keeps it when given', () => {
    const basic = entry({ id: 'a', isBasic: true });
    const { hiddenFromClient: _omit, ...withoutFlag } = line({
      catalogIngredientId: 'a',
    });
    const [absent, shown] = stampLines(
      [withoutFlag, line({ catalogIngredientId: 'a', hiddenFromClient: false })],
      mapOf(basic),
    );
    expect(absent.hiddenFromClient).toBe(true);
    expect(shown.hiddenFromClient).toBe(false);
  });

  it('links a merged entry through the id of its target', () => {
    const target = entry({ id: 'target', name: 'Tomate cerise' });
    const entries = new Map([['old', target]]);
    const [stamped] = stampLines([line({ catalogIngredientId: 'old' })], entries);
    expect(stamped.catalogIngredientId).toBe('target');
    expect(stamped.name).toBe('Tomate cerise');
  });

  it('unlinks an unknown id, to verify, with its raw text', () => {
    const [stamped, kept] = stampLines(
      [
        line({ catalogIngredientId: 'ghost' }),
        line({ catalogIngredientId: 'ghost', rawText: 'deux tomates' }),
      ],
      new Map(),
    );
    expect(stamped).toMatchObject({
      catalogIngredientId: null,
      toVerify: true,
      rawText: '2 kg tomates',
      allergens: [],
    });
    expect(kept.rawText).toBe('deux tomates');
  });

  it('keeps the name of an unlinked line and gives it no allergens', () => {
    const [stamped] = stampLines([line({ name: 'sel magique' })], new Map());
    expect(stamped).toMatchObject({
      name: 'sel magique',
      allergens: [],
      incomplete: false,
      toVerify: false,
    });
  });
});

describe('entriesFor', () => {
  it('reads the ids then the merge targets, in two queries at most', async () => {
    const { db: prisma, findMany } = db([
      entry({ id: 'old', status: 'merged', mergedIntoId: 'target' }),
      entry({ id: 'target', name: 'Cible' }),
      entry({ id: 'plain' }),
    ]);
    const map = await entriesFor(prisma, ['old', 'plain', 'old']);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(map.get('old')?.id).toBe('target');
    expect(map.get('plain')?.id).toBe('plain');
  });

  it('makes no query without ids, and one without a merge', async () => {
    const empty = db([]);
    expect((await entriesFor(empty.db, [])).size).toBe(0);
    expect(empty.findMany).not.toHaveBeenCalled();
    const one = db([entry({ id: 'a' })]);
    await entriesFor(one.db, ['a']);
    expect(one.findMany).toHaveBeenCalledTimes(1);
  });

  it('leaves out a merged entry whose target is gone', async () => {
    const { db: prisma } = db([
      entry({ id: 'old', status: 'merged', mergedIntoId: 'gone' }),
    ]);
    expect((await entriesFor(prisma, ['old'])).has('old')).toBe(false);
  });

  // Recettes §7.3: a deactivated entry stays valid on the lines that have it, so a
  // line merged into it before must keep its allergens, never drop them.
  it('follows a merge into a target deactivated since, whatever its status', async () => {
    const { db: prisma, findMany } = db([
      entry({ id: 'old', status: 'merged', mergedIntoId: 'target' }),
      entry({
        id: 'target',
        name: 'Beurre',
        status: 'inactive',
        allergens: ['milk'],
        allergensNone: false,
      }),
    ]);

    const result = await compositionOf(prisma, [line({ catalogIngredientId: 'old' })], {
      addedAllergens: [],
      customAllergens: [],
    });

    expect(findMany.mock.calls[1][0]).toEqual(
      expect.objectContaining({ where: { id: { in: ['target'] } } }),
    );
    expect(result.ingredients[0]).toMatchObject({
      catalogIngredientId: 'target',
      name: 'Beurre',
      allergens: ['milk'],
    });
    expect(result.state.allergens).toEqual(['milk']);
  });
});

describe('compositionOf', () => {
  it('stamps, computes the allergen state and classifies', async () => {
    const { db: prisma } = db([
      entry({ id: 'a', allergens: ['gluten'], allergensNone: false }),
    ]);
    const result = await compositionOf(prisma, [line({ catalogIngredientId: 'a' })], {
      addedAllergens: [],
      customAllergens: [],
    });
    expect(result.ingredients[0].allergens).toEqual(['gluten']);
    expect(result.state.allergens).toEqual(['gluten']);
    expect(result.classification).toEqual({
      diets: ['vegan'],
      seasonMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    });
  });
});

describe('assertIngredientAccess (Recettes §4.10)', () => {
  const scope = (chefProfileId: string | null, previous: string[] = []) => ({
    chefProfileId,
    previousIds: new Set(previous),
  });
  const check = (rows: EntryRow[], ids: string[], s: ReturnType<typeof scope>) =>
    assertIngredientAccess(
      db(rows).db,
      ids.map((id) => line({ catalogIngredientId: id })),
      s,
    );

  it('accepts an active common entry and a pending private one of the same chef', async () => {
    await expect(
      check([entry({ id: 'a' })], ['a'], scope('chef-1')),
    ).resolves.toBeUndefined();
    await expect(
      check(
        [entry({ id: 'p', chefProfileId: 'chef-1', status: 'pending' })],
        ['p'],
        scope('chef-1'),
      ),
    ).resolves.toBeUndefined();
  });

  it('refuses a private entry of another chef, naming the line', async () => {
    const rows = [entry({ id: 'a' }), entry({ id: 'p', chefProfileId: 'chef-2' })];
    const error = await check(rows, ['a', 'p'], scope('chef-1')).catch((e: unknown) => e);
    const body = (error as { getResponse: () => Record<string, unknown> }).getResponse();
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(body)).toContain('recipe.ingredients[1]');
  });

  it("refuses a private entry in a Lab's Food recipe", async () => {
    await expect(
      check([entry({ id: 'p', chefProfileId: 'chef-1' })], ['p'], scope(null)),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('refuses an inactive common entry unless the dish already had it', async () => {
    const rows = [entry({ id: 'i', status: 'inactive' })];
    await expect(check(rows, ['i'], scope('chef-1'))).rejects.toMatchObject({
      status: 422,
    });
    await expect(check(rows, ['i'], scope('chef-1', ['i']))).resolves.toBeUndefined();
  });

  it('refuses a merged entry, and an unknown one', async () => {
    const rows = [entry({ id: 'm', status: 'merged', mergedIntoId: 'a' })];
    await expect(check(rows, ['m'], scope('chef-1', ['m']))).rejects.toMatchObject({
      status: 422,
    });
    await expect(check(rows, ['ghost'], scope('chef-1'))).rejects.toMatchObject({
      status: 422,
    });
  });
});
