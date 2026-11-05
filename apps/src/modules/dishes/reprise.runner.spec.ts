import { MealStatus, Prisma } from '../../generated/prisma/client';
import { dishRow, entryRow } from './dishes.test-helpers';
import { missingAllergens } from './domain/reprise.rules';
import {
  formatReport,
  RepriseDb,
  RepriseMailer,
  RepriseReport,
  runReprise,
} from './reprise.runner';

type Entry = ReturnType<typeof entryRow> & {
  aliases: string[];
  normalizedName: string | null;
};
type Row = ReturnType<typeof dishRow> & {
  offeredToChefProfileId?: string | null;
  publishedAt?: Date | null;
};
type NotificationRow = {
  id: string;
  userId: string;
  type: string;
  subjectType: string;
  subjectId: string;
};

const VERIFIED_AT = new Date('2026-11-01T09:00:00.000Z');
const PUBLISHED_AT = new Date('2026-10-01T09:00:00.000Z');

const CHEFS = {
  'chef-1': {
    id: 'chef-1',
    userId: 'user-1',
    displayName: 'Marie Dupont',
    user: { email: 'marie@example.com', fullName: 'Marie Dupont' },
  },
  'chef-2': {
    id: 'chef-2',
    userId: 'user-2',
    displayName: 'Paul Martin',
    user: { email: 'paul@example.com', fullName: null },
  },
} as const;

const entry = (over: { id: string } & Partial<Entry>): Entry => ({
  ...entryRow(over),
  aliases: [],
  normalizedName: null,
  ...over,
});

/** The common list as imported: some names not yet normalized (Recettes §9 step 1). */
const ENTRIES = (): Entry[] => [
  entry({ id: 'cat-tomate', name: 'Tomate', normalizedName: 'tomate' }),
  entry({
    id: 'cat-beurre',
    name: 'Beurre',
    aliases: ['beurre doux'],
    allergens: ['milk'],
    allergensNone: false,
  }),
  entry({
    id: 'cat-farine',
    name: 'Farine de blé',
    aliases: ['farine'],
    allergens: ['gluten'],
    allergensNone: false,
  }),
  entry({ id: 'cat-ail', name: 'Ail', normalizedName: 'ail' }),
  // Inactive: never linked by the reprise, whatever its name.
  entry({ id: 'cat-cerise', name: 'Tomate cerise', status: 'inactive' }),
];

/** A legacy dish: lines never stamped, allergens declared by hand. */
const legacy = (over: Record<string, unknown>): Row =>
  dishRow({
    addedAllergens: [],
    conditionalAllergens: [],
    lockVersion: 0,
    ...over,
  }) as Row;

/**
 * Marie's two dishes, Paul's one, a Lab's Food recipe and a Lab's Food offer to
 * Paul. Marie's published dish was verified, and its butter brings milk, which she
 * never declared: the reprise finds a new allergen there.
 */
const MEALS = (): Row[] => [
  legacy({
    id: 'dish-1',
    status: MealStatus.published,
    publishedAt: PUBLISHED_AT,
    allergensVerifiedAt: VERIFIED_AT,
    recipeVersion: 2,
    lockVersion: 3,
    ingredients: [
      { name: 'Tomates', qty: 3, unit: '' },
      { name: 'Beurre doux', qty: 50, unit: 'grammes' },
      { name: 'Basilic', qty: 1, unit: 'poignée' },
      { name: 'tomates cerises', qty: 200, unit: 'g' },
    ],
    allergens: ['gluten'],
    storage: { method: 'freezer', days: 60 },
  }),
  legacy({
    id: 'dish-2',
    allergensVerifiedAt: VERIFIED_AT,
    ingredients: [{ name: 'Ail', qty: 2, unit: 'gousse' }],
    allergens: ['milk'],
    storage: { method: 'fridge', days: 3 },
  }),
  legacy({
    id: 'dish-3',
    chefProfileId: 'chef-2',
    status: MealStatus.published,
    publishedAt: PUBLISHED_AT,
    ingredients: [{ name: 'Farine', qty: 200, unit: 'gr' }],
    allergens: ['gluten'],
  }),
  legacy({
    id: 'lf-1',
    chefProfileId: null,
    allergensVerifiedAt: VERIFIED_AT,
    ingredients: [{ name: 'Beurre', qty: 20, unit: 'g' }],
    allergens: [],
  }),
  legacy({
    id: 'offer-1',
    chefProfileId: null,
    offeredToChefProfileId: 'chef-2',
    ingredients: [{ name: 'Tomates', qty: 2, unit: 'pièces' }],
    allergens: [],
  }),
];

/** What Prisma throws when a write's `where` matches no row. */
const noRowMatched = () =>
  new Prisma.PrismaClientKnownRequestError('No record was found for an update.', {
    code: 'P2025',
    clientVersion: 't',
  });

/** A JSON column reads back as JSON; `Prisma.DbNull` reads back as null. */
const stored = (value: unknown) => {
  if (value === Prisma.DbNull) return null;
  if (value instanceof Date || value === null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value));
};

/**
 * An in-memory database: a write on an outdated `lockVersion` (or on a name already
 * filled) matches nothing, `{ increment }` adds up, and the reads answer the
 * shapes the runner asks for.
 */
function database(
  seed: { entries?: Entry[]; meals?: Row[]; notifications?: NotificationRow[] } = {},
) {
  const entries = (seed.entries ?? ENTRIES()).map((e) => structuredClone(e));
  const meals = new Map((seed.meals ?? MEALS()).map((m) => [m.id, structuredClone(m)]));
  const notifications = [...(seed.notifications ?? [])];

  const catalogIngredient = {
    findMany: jest.fn(async (args: { where?: Record<string, unknown> } = {}) => {
      const where = args.where ?? {};
      return entries
        .filter((e) => {
          const ids = (where.id as { in?: string[] } | undefined)?.in;
          if (ids && !ids.includes(e.id)) return false;
          if ('chefProfileId' in where && e.chefProfileId !== where.chefProfileId) {
            return false;
          }
          return !where.status || e.status === where.status;
        })
        .map((e) => structuredClone(e));
    }),
    update: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string; normalizedName?: string | null };
        data: Partial<Entry>;
      }) => {
        const row = entries.find((e) => e.id === where.id);
        if (
          !row ||
          (where.normalizedName !== undefined &&
            row.normalizedName !== where.normalizedName)
        ) {
          throw noRowMatched();
        }
        Object.assign(row, data);
        return structuredClone(row);
      },
    ),
  };

  const meal = {
    findMany: jest.fn(async () => [...meals.keys()].map((id) => ({ id }))),
    findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
      const row = meals.get(where.id);
      if (!row) return null;
      const owner = row.chefProfileId
        ? CHEFS[row.chefProfileId as keyof typeof CHEFS]
        : null;
      return { ...structuredClone(row), chefProfile: owner && structuredClone(owner) };
    }),
    update: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string; lockVersion?: number };
        data: Record<string, unknown>;
      }) => {
        const row = meals.get(where.id) as Record<string, unknown> | undefined;
        if (
          !row ||
          (where.lockVersion !== undefined && row.lockVersion !== where.lockVersion)
        ) {
          throw noRowMatched();
        }
        for (const [key, value] of Object.entries(data)) {
          const increment = (value as { increment?: number } | null)?.increment;
          row[key] =
            typeof increment === 'number'
              ? (row[key] as number) + increment
              : stored(value);
        }
        return structuredClone(row);
      },
    ),
  };

  const notification = {
    findFirst: jest.fn(async ({ where }: { where: Partial<NotificationRow> }) => {
      const found = notifications.find((n) =>
        Object.entries(where).every(
          ([key, value]) => n[key as keyof NotificationRow] === value,
        ),
      );
      return found ? { id: found.id } : null;
    }),
    create: jest.fn(async ({ data }: { data: Omit<NotificationRow, 'id'> }) => {
      const row = { id: `n-${notifications.length + 1}`, ...data };
      notifications.push(row);
      return row;
    }),
  };

  const client = { catalogIngredient, meal, notification };
  const $transaction = jest.fn(async (work: (tx: unknown) => Promise<unknown>) =>
    work(client),
  );
  return {
    db: { ...client, $transaction } as unknown as RepriseDb,
    entries,
    meals,
    notifications,
    ...client,
    $transaction,
  };
}

function mailer() {
  return {
    recipesMigrated: jest.fn(async (_input: Record<string, unknown>) => ({ sent: true })),
    recipeAllergensChanged: jest.fn(async (_input: Record<string, unknown>) => ({
      sent: true,
    })),
  };
}

const run = (h: ReturnType<typeof database>, m = mailer(), dryRun = false) =>
  runReprise(h.db, m as unknown as RepriseMailer, { dryRun });

const tallyOf = (report: RepriseReport, chefProfileId: string | null) =>
  report.chefs.find((c) => c.chefProfileId === chefProfileId);

describe('runReprise (Recettes §9)', () => {
  it('links, converts, carries and stamps a dish, lockVersion +1', async () => {
    const h = database();
    await run(h);
    const dish = h.meals.get('dish-1')!;

    expect(dish.lockVersion).toBe(4);
    expect(dish.ingredients).toEqual([
      expect.objectContaining({
        name: 'Tomate',
        catalogIngredientId: 'cat-tomate',
        unit: 'piece',
        qty: 3,
        toVerify: false,
        allergens: [],
      }),
      expect.objectContaining({
        name: 'Beurre',
        catalogIngredientId: 'cat-beurre',
        unit: 'g',
        qty: 50,
        allergens: ['milk'],
      }),
      expect.objectContaining({
        name: 'Basilic',
        catalogIngredientId: null,
        toVerify: true,
        unit: null,
        rawText: '1 poignée Basilic',
      }),
      // Only an inactive "Tomate cerise" exists, and "Tomate" is no match.
      expect.objectContaining({
        name: 'tomates cerises',
        catalogIngredientId: null,
        toVerify: true,
        unit: 'g',
        rawText: '200 g tomates cerises',
      }),
    ]);
    expect(dish.addedAllergens).toEqual(['gluten']);
    expect(dish.allergens).toEqual(['gluten', 'milk']);
    expect(dish.allergensNone).toBe(false);
    expect(dish.storage).toEqual({ method: 'freezer', days: 60, freezable: true });
  });

  it('never touches the status, the publication, the versions or the bookings', async () => {
    const h = database();
    const report = await run(h);

    const dish = h.meals.get('dish-1')!;
    expect(dish.status).toBe(MealStatus.published);
    expect(dish.publishedAt).toEqual(PUBLISHED_AT);
    expect(dish.recipeVersion).toBe(2);
    expect(dish.versionPending).toBe(false);
    expect(h.meal.update).toHaveBeenCalledTimes(5);
    for (const [{ data }] of h.meal.update.mock.calls) {
      expect(data).not.toHaveProperty('status');
      expect(data).not.toHaveProperty('publishedAt');
      expect(data).not.toHaveProperty('recipeVersion');
      expect(data).not.toHaveProperty('versionPending');
    }
    // The double has no versions nor bookings: any use of them would fail a dish.
    expect(report.failed).toEqual([]);
  });

  it('never loses an allergen, on any dish (Review Focus 3)', async () => {
    const before = MEALS();
    const h = database();
    await run(h);
    for (const dish of before) {
      expect(missingAllergens(dish.allergens, h.meals.get(dish.id)!.allergens)).toEqual(
        [],
      );
    }
  });

  it('keeps an allergen a stale stamp brought, though the entry no longer has it', async () => {
    // Stamped when butter still listed eggs; the entry was corrected since and the
    // §7.3 carry never reached this dish.
    const stale = legacy({
      id: 'dish-stale',
      ingredients: [
        {
          name: 'Beurre',
          qty: 10,
          unit: 'g',
          aisle: 'cremerie',
          link: null,
          toVerify: false,
          fixedQuantity: false,
          catalogIngredientId: 'cat-beurre',
          optional: false,
          precision: null,
          preparation: null,
          group: null,
          hiddenFromClient: false,
          rawText: null,
          allergens: ['eggs', 'milk'],
          incomplete: false,
        },
      ],
      allergens: ['eggs', 'milk'],
    });
    const h = database({ meals: [stale] });
    await run(h);

    const dish = h.meals.get('dish-stale')!;
    expect(dish.allergens).toEqual(['eggs', 'milk']);
    expect(dish.addedAllergens).toEqual(['eggs']);

    // And a second run leaves it as it is.
    h.meal.update.mockClear();
    const again = await run(h);
    expect(h.meal.update).not.toHaveBeenCalled();
    expect(again.changed).toBe(0);
  });

  it('clears a verification only when a new allergen appears, and tells the owner', async () => {
    const h = database();
    const report = await run(h);

    expect(h.meals.get('dish-1')!.allergensVerifiedAt).toBeNull();
    expect(h.meals.get('dish-2')!.allergensVerifiedAt).toEqual(VERIFIED_AT);
    // Lab's Food's own recipe: cleared, and nobody is told.
    expect(h.meals.get('lf-1')!.allergensVerifiedAt).toBeNull();
    expect(h.notifications.filter((n) => n.type === 'recipe_allergens_changed')).toEqual([
      expect.objectContaining({
        userId: 'user-1',
        subjectType: 'meal',
        subjectId: 'dish-1',
      }),
    ]);
    expect(tallyOf(report, 'chef-1')!.verificationsCleared).toBe(1);
    expect(tallyOf(report, null)!.verificationsCleared).toBe(1);
  });

  it('tells each chef once: one recipes_migrated and one e-mail with the counts', async () => {
    const h = database();
    const m = mailer();
    const report = await run(h, m);

    expect(h.notifications.filter((n) => n.type === 'recipes_migrated')).toEqual([
      expect.objectContaining({
        userId: 'user-1',
        subjectType: 'chef_profile',
        subjectId: 'chef-1',
      }),
      expect.objectContaining({
        userId: 'user-2',
        subjectType: 'chef_profile',
        subjectId: 'chef-2',
      }),
    ]);
    expect(m.recipesMigrated).toHaveBeenCalledTimes(2);
    expect(m.recipesMigrated).toHaveBeenCalledWith({
      email: 'marie@example.com',
      name: 'Marie Dupont',
      dishCount: 2,
      linesToVerify: 2,
    });
    expect(m.recipesMigrated).toHaveBeenCalledWith({
      email: 'paul@example.com',
      name: null,
      dishCount: 1,
      linesToVerify: 0,
    });
    expect(m.recipeAllergensChanged).toHaveBeenCalledTimes(1);
    expect(m.recipeAllergensChanged).toHaveBeenCalledWith({
      email: 'marie@example.com',
      name: 'Marie Dupont',
      dishCount: 1,
    });
    expect(report.emails).toEqual({
      recipesMigrated: 2,
      allergensChanged: 1,
      sent: 3,
      notSent: 0,
    });
    expect(report.notifications).toEqual({ recipesMigrated: 2, allergensChanged: 1 });
  });

  it('counts per chef, Lab’s Food apart, with the totals', async () => {
    const report = await run(database());

    expect(report.meals).toBe(5);
    expect(report.changed).toBe(5);
    expect(report.unchanged).toBe(0);
    expect(report.chefs).toEqual([
      {
        chefProfileId: 'chef-1',
        label: 'Marie Dupont',
        dishesChanged: 2,
        linesLinked: 3,
        linesToVerify: 2,
        verificationsCleared: 1,
        told: 'now',
      },
      {
        chefProfileId: 'chef-2',
        label: 'Paul Martin',
        dishesChanged: 1,
        linesLinked: 1,
        linesToVerify: 0,
        verificationsCleared: 0,
        told: 'now',
      },
      {
        chefProfileId: null,
        label: "Lab's Food (recipes and offers)",
        dishesChanged: 2,
        linesLinked: 2,
        linesToVerify: 0,
        verificationsCleared: 1,
        told: null,
      },
    ]);
  });

  it('ranks the names left unlinked by frequency, and reports ambiguous keys', async () => {
    const entries = [
      ...ENTRIES(),
      entry({ id: 'cat-creme-1', name: 'Crème', aliases: ['creme fraiche'] }),
      entry({ id: 'cat-creme-2', name: 'Crème fraîche' }),
    ];
    const meals = [
      legacy({
        id: 'dish-a',
        ingredients: [
          { name: 'Basilic', qty: 1, unit: 'poignée' },
          { name: 'Crème fraîche', qty: 10, unit: 'cl' },
        ],
      }),
      legacy({ id: 'dish-b', ingredients: [{ name: 'basilic', qty: 2, unit: 'g' }] }),
    ];
    const report = await run(database({ entries, meals }));

    expect(report.unmatched).toEqual([
      { name: 'Basilic', count: 2 },
      { name: 'Crème fraîche', count: 1 },
    ]);
    expect(report.ambiguous).toEqual([
      { key: 'creme fraiche', ids: ['cat-creme-1', 'cat-creme-2'] },
    ]);
  });

  it('changes nothing on a second run: no write, no notification, no e-mail', async () => {
    const h = database();
    await run(h);
    const after = structuredClone([...h.meals.values()]);
    const notified = h.notifications.length;
    h.meal.update.mockClear();
    h.catalogIngredient.update.mockClear();
    const m = mailer();

    const again = await run(h, m);

    expect(h.meal.update).not.toHaveBeenCalled();
    expect(h.catalogIngredient.update).not.toHaveBeenCalled();
    expect([...h.meals.values()]).toEqual(after);
    expect(h.notifications).toHaveLength(notified);
    expect(m.recipesMigrated).not.toHaveBeenCalled();
    expect(m.recipeAllergensChanged).not.toHaveBeenCalled();
    expect(again.changed).toBe(0);
    expect(again.unchanged).toBe(5);
    expect(again.chefs).toEqual([]);
    expect(again.names.filled).toBe(0);
  });

  it('writes nothing and sends nothing in a dry run, reporting what it would do', async () => {
    const h = database();
    const m = mailer();
    const dry = await run(h, m, true);

    expect(h.meal.update).not.toHaveBeenCalled();
    expect(h.catalogIngredient.update).not.toHaveBeenCalled();
    expect(h.notification.create).not.toHaveBeenCalled();
    expect(h.$transaction).not.toHaveBeenCalled();
    expect(m.recipesMigrated).not.toHaveBeenCalled();
    expect(m.recipeAllergensChanged).not.toHaveBeenCalled();
    expect([...h.meals.values()]).toEqual(MEALS());

    const real = await run(database());
    expect(dry.chefs).toEqual(real.chefs);
    expect(dry.changed).toBe(real.changed);
    expect(dry.unmatched).toEqual(real.unmatched);
    expect(dry.names).toEqual(real.names);
    expect(dry.notifications).toEqual(real.notifications);
    expect(dry.emails).toEqual({ ...real.emails, sent: 0, notSent: 0 });
  });

  it('does not tell again a chef an earlier run told', async () => {
    const h = database({
      notifications: [
        {
          id: 'n-0',
          userId: 'user-1',
          type: 'recipes_migrated',
          subjectType: 'chef_profile',
          subjectId: 'chef-1',
        },
      ],
    });
    const m = mailer();
    const report = await run(h, m);

    expect(tallyOf(report, 'chef-1')!.told).toBe('before');
    expect(h.notifications.filter((n) => n.type === 'recipes_migrated')).toHaveLength(2);
    expect(m.recipesMigrated).toHaveBeenCalledTimes(1);
    expect(m.recipesMigrated).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'paul@example.com' }),
    );
    // Its verification cleared by this run: that e-mail still goes.
    expect(m.recipeAllergensChanged).toHaveBeenCalledTimes(1);
  });

  it('skips a dish saved meanwhile, and a rerun picks it up without telling twice', async () => {
    const h = database();
    const read = h.meal.findUnique.getMockImplementation()!;
    // The chef saves dish-2 between the reprise's read and its write.
    h.meal.findUnique
      .mockImplementationOnce(read)
      .mockImplementationOnce(async (args) => {
        const row = await read(args);
        h.meals.get('dish-2')!.lockVersion += 1;
        return row;
      });

    const report = await run(h);
    expect(report.skipped).toEqual(['dish-2']);
    expect(report.changed).toBe(4);
    expect(h.meals.get('dish-2')!.ingredients).toEqual(MEALS()[1].ingredients);
    expect(formatReport(report).join('\n')).toContain('dish-2');

    const m = mailer();
    const again = await run(h, m);
    expect(again.changed).toBe(1);
    expect(again.skipped).toEqual([]);
    expect(h.meals.get('dish-2')!.ingredients).toEqual([
      expect.objectContaining({ catalogIngredientId: 'cat-ail', unit: 'clove' }),
    ]);
    expect(tallyOf(again, 'chef-1')!.told).toBe('before');
    expect(h.notifications.filter((n) => n.type === 'recipes_migrated')).toHaveLength(2);
    expect(m.recipesMigrated).not.toHaveBeenCalled();
  });

  it('counts a dish whose write fails as failed, and goes on with the others', async () => {
    const h = database();
    const write = h.meal.update.getMockImplementation()!;
    h.meal.update.mockImplementation(async (args) => {
      if (args.where.id === 'dish-3') throw new Error('connection reset');
      return write(args);
    });

    const report = await run(h);
    expect(report.failed).toEqual([{ id: 'dish-3', error: 'connection reset' }]);
    expect(report.changed).toBe(4);
    expect(tallyOf(report, 'chef-2')).toBeUndefined();
    expect(h.meals.get('lf-1')!.lockVersion).toBe(1);
  });

  it('fills the missing normalized names, reporting a name already taken', async () => {
    const entries = [
      ...ENTRIES(),
      // Same normalized name as "Tomate", common too: the unique index forbids it.
      entry({ id: 'cat-tomate-2', name: 'TOMATE', status: 'inactive' }),
      // A chef's pending entry is unique per chef only.
      entry({
        id: 'cat-private',
        name: 'Tomate',
        chefProfileId: 'chef-1',
        status: 'pending',
      }),
    ];
    const h = database({ entries });
    const report = await run(h);

    expect(report.names.filled).toBe(4);
    expect(report.names.conflicts).toEqual([
      { id: 'cat-tomate-2', name: 'TOMATE', normalizedName: 'tomate' },
    ]);
    const byId = new Map(h.entries.map((e) => [e.id, e.normalizedName]));
    expect(byId.get('cat-beurre')).toBe('beurre');
    expect(byId.get('cat-farine')).toBe('farine de ble');
    expect(byId.get('cat-cerise')).toBe('tomate cerise');
    expect(byId.get('cat-private')).toBe('tomate');
    expect(byId.get('cat-tomate-2')).toBeNull();
  });
});

describe('formatReport', () => {
  it('says "would" in a dry run, and what was done otherwise', async () => {
    const dry = formatReport(await run(database(), mailer(), true)).join('\n');
    const real = formatReport(await run(database())).join('\n');

    expect(dry).toMatch(/would/i);
    expect(real).not.toMatch(/would/i);
    for (const text of [dry, real]) {
      expect(text).toContain('Marie Dupont');
      expect(text).toContain("Lab's Food");
      expect(text).toContain('Basilic');
    }
  });
});
