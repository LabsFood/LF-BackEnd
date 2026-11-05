import { AuditService } from '../../common/audit/audit.service';
import { MealStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DishesMailer } from '../dishes/dishes.mailer';
import { composeLines, compositionColumns } from '../dishes/dishes.service';
import { dishRow, entryRow } from '../dishes/dishes.test-helpers';
import { NotificationsService } from '../notifications/notifications.service';
import { LineToStamp } from './composition';
import { IngredientPropagationService } from './ingredient-propagation.service';

type Entry = ReturnType<typeof entryRow>;
type Owner = { userId: string; user: { email: string; fullName: string | null } };
type Dish = ReturnType<typeof dishRow> & { chefProfile: Owner | null };
type StoredLineJson = { name: string; aisle: string | null; catalogIngredientId: string };

const VERIFIED_AT = new Date('2026-11-01T09:00:00.000Z');

const BUTTER = entryRow({ id: 'cat-beurre', name: 'Beurre', aisle: 'cremerie' });
const CELERY = entryRow({
  id: 'cat-celeri',
  name: 'Céleri-rave',
  allergens: ['celery'],
  allergensNone: false,
});
const WITH_MILK = { allergens: ['milk'], allergensNone: false };

const MARIE: Owner = {
  userId: 'user-1',
  user: { email: 'marie@example.com', fullName: 'Marie Dupont' },
};
const PAUL: Owner = {
  userId: 'user-2',
  user: { email: 'paul@example.com', fullName: null },
};

const line = (
  name: string,
  catalogIngredientId: string | null,
  over: Partial<LineToStamp> = {},
): LineToStamp => ({
  name,
  qty: 1,
  unit: 'piece',
  aisle: null,
  link: null,
  toVerify: false,
  fixedQuantity: false,
  catalogIngredientId,
  optional: false,
  precision: null,
  preparation: null,
  group: null,
  hiddenFromClient: false,
  rawText: null,
  ...over,
});

const BUTTER_AND_CELERY = [
  line('Beurre', 'cat-beurre'),
  line('Céleri-rave', 'cat-celeri'),
];

/** Answers by id, as `entriesFor` reads the list. */
const findEntries = (entries: () => Entry[]) =>
  jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
    entries().filter((entry) => where.id.in.includes(entry.id)),
  );

/**
 * A published, verified dish of Marie's as a save stores it from `entries`: lines
 * stamped, allergens composed, classified. `over` sets anything else.
 */
async function saved(
  entries: Entry[],
  lines: LineToStamp[],
  over: Record<string, unknown> = {},
): Promise<Dish> {
  const db = { catalogIngredient: { findMany: findEntries(() => entries) } };
  const composed = await composeLines(db as unknown as PrismaService, null, {}, lines);
  return {
    chefProfile: MARIE,
    ...dishRow({
      ...compositionColumns(composed),
      classification: composed.classification,
      status: MealStatus.published,
      allergensVerifiedAt: VERIFIED_AT,
      lockVersion: 4,
      ...over,
    }),
  } as Dish;
}

/** What Prisma throws when a write's `where` matches no row. */
const noRowMatched = () =>
  new Prisma.PrismaClientKnownRequestError('No record was found for an update.', {
    code: 'P2025',
    clientVersion: 't',
  });

/**
 * The service over an in-memory database: a write on an outdated `lockVersion`
 * matches nothing, `{ increment }` adds up, and the dish search reads the ids of
 * its `array_contains` conditions. `change` is Lab's Food editing an entry.
 */
function harness(entries: Entry[], dishes: Dish[]) {
  let list = [...entries];
  const rows = new Map(dishes.map((dish) => [dish.id, dish]));
  const linked = (dish: Dish, ids: string[]) =>
    (dish.ingredients as StoredLineJson[]).some((l) =>
      ids.includes(l.catalogIngredientId),
    );
  const meal = {
    findMany: jest.fn(
      async ({
        where,
      }: {
        where: {
          OR: { ingredients: { array_contains: { catalogIngredientId: string }[] } }[];
        };
      }) => {
        const ids = where.OR.map(
          (c) => c.ingredients.array_contains[0].catalogIngredientId,
        );
        return [...rows.values()]
          .filter((d) => linked(d, ids))
          .map((d) => ({ id: d.id }));
      },
    ),
    findUnique: jest.fn(
      async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null,
    ),
    update: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string; lockVersion?: number };
        data: Record<string, unknown>;
      }) => {
        const row = rows.get(where.id);
        if (
          !row ||
          (where.lockVersion !== undefined && where.lockVersion !== row.lockVersion)
        ) {
          throw noRowMatched();
        }
        const { lockVersion, ...rest } = data as { lockVersion?: { increment: number } };
        const next = {
          ...row,
          ...rest,
          lockVersion: row.lockVersion + (lockVersion?.increment ?? 0),
        } as Dish;
        // The database reads a JSON null back as null.
        if (next.classification === Prisma.DbNull) next.classification = null;
        rows.set(row.id, next);
        return next;
      },
    ),
  };
  const client = { meal, catalogIngredient: { findMany: findEntries(() => list) } };
  const $transaction = jest.fn(async (work: (tx: typeof client) => Promise<unknown>) =>
    work(client),
  );
  const notifications = { notify: jest.fn(async (..._args: unknown[]) => ({})) };
  const mailer = {
    recipeAllergensChanged: jest.fn(async (_input: object) => ({ sent: true })),
  };
  const audit = { record: jest.fn(async (_entry: object) => undefined) };
  const service = new IngredientPropagationService(
    { ...client, $transaction } as unknown as PrismaService,
    notifications as unknown as NotificationsService,
    mailer as unknown as DishesMailer,
    audit as unknown as AuditService,
  );
  const change = (id: string, over: Partial<Entry>) => {
    list = list.map((entry) => (entry.id === id ? { ...entry, ...over } : entry));
  };
  /** A chef's save lands between the propagation's read and its write. */
  const chefSavesMeanwhile = () =>
    meal.findUnique.mockImplementationOnce(async ({ where }) => {
      const row = rows.get(where.id)!;
      rows.set(row.id, { ...row, lockVersion: row.lockVersion + 1 });
      return row;
    });
  return {
    rows,
    meal,
    client,
    notifications,
    mailer,
    audit,
    service,
    change,
    chefSavesMeanwhile,
  };
}

describe('IngredientPropagationService.propagate (Recettes §7.3)', () => {
  it('finds the dishes with the array_contains query, one condition per entry', async () => {
    const h = harness([BUTTER], []);

    await h.service.propagate(['cat-beurre', 'cat-celeri'], 'admin-1');

    expect(h.meal.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { ingredients: { array_contains: [{ catalogIngredientId: 'cat-beurre' }] } },
          { ingredients: { array_contains: [{ catalogIngredientId: 'cat-celeri' }] } },
        ],
      },
      select: { id: true },
    });
  });

  // Review Focus point 2, propagation side.
  it('recomputes a verified dish whose ingredient gains milk, clears the verification and tells its chef', async () => {
    const dish = await saved([BUTTER, CELERY], BUTTER_AND_CELERY);
    const h = harness([BUTTER, CELERY], [dish]);
    h.change('cat-beurre', WITH_MILK);

    const result = await h.service.propagate(['cat-beurre'], 'admin-1');

    expect(h.meal.update).toHaveBeenCalledTimes(1);
    const { where, data } = h.meal.update.mock.calls[0][0];
    expect(where).toEqual({ id: 'dish-1', lockVersion: 4 });
    expect(data).toMatchObject({
      lockVersion: { increment: 1 },
      allergensVerifiedAt: null,
      allergens: ['milk', 'celery'],
    });
    // Still published, not sent back to moderation.
    expect(data).not.toHaveProperty('status');
    expect(data).not.toHaveProperty('reviewPendingSince');
    expect(h.rows.get('dish-1')).toMatchObject({
      status: MealStatus.published,
      lockVersion: 5,
      allergens: ['milk', 'celery'],
      allergensNone: false,
      allergensVerifiedAt: null,
      ingredients: [
        expect.objectContaining({ name: 'Beurre', allergens: ['milk'] }),
        expect.objectContaining({ name: 'Céleri-rave', allergens: ['celery'] }),
      ],
    });
    expect(h.notifications.notify).toHaveBeenCalledTimes(1);
    expect(h.notifications.notify).toHaveBeenCalledWith(
      'user-1',
      'recipe_allergens_changed',
      { type: 'meal', id: 'dish-1' },
      h.client,
    );
    expect(h.mailer.recipeAllergensChanged).toHaveBeenCalledWith({
      email: 'marie@example.com',
      name: 'Marie Dupont',
      dishCount: 1,
    });
    expect(result).toEqual({ dishes: 1, reverified: 1, chefs: 1, skipped: 0 });
  });

  it('notifies once per dish but e-mails once per chef', async () => {
    const dishes = await Promise.all([
      saved([BUTTER, CELERY], BUTTER_AND_CELERY, { id: 'dish-1' }),
      saved([BUTTER, CELERY], BUTTER_AND_CELERY, { id: 'dish-2' }),
      saved([BUTTER, CELERY], BUTTER_AND_CELERY, { id: 'dish-3' }),
      saved([BUTTER, CELERY], BUTTER_AND_CELERY, {
        id: 'dish-4',
        chefProfileId: 'chef-2',
        chefProfile: PAUL,
      }),
    ]);
    const h = harness([BUTTER, CELERY], dishes);
    h.change('cat-beurre', WITH_MILK);

    const result = await h.service.propagate(['cat-beurre'], 'admin-1');

    expect(h.notifications.notify).toHaveBeenCalledTimes(4);
    expect(h.mailer.recipeAllergensChanged).toHaveBeenCalledTimes(2);
    expect(h.mailer.recipeAllergensChanged).toHaveBeenCalledWith({
      email: 'marie@example.com',
      name: 'Marie Dupont',
      dishCount: 3,
    });
    expect(h.mailer.recipeAllergensChanged).toHaveBeenCalledWith({
      email: 'paul@example.com',
      name: null,
      dishCount: 1,
    });
    expect(result).toEqual({ dishes: 4, reverified: 4, chefs: 2, skipped: 0 });
  });

  it('carries a new aisle onto the lines and keeps the verification, telling nobody', async () => {
    const h = harness(
      [BUTTER, CELERY],
      [await saved([BUTTER, CELERY], BUTTER_AND_CELERY)],
    );
    h.change('cat-beurre', { aisle: 'epicerie-salee' });

    const result = await h.service.propagate(['cat-beurre'], 'admin-1');

    const after = h.rows.get('dish-1')!;
    expect((after.ingredients as StoredLineJson[])[0].aisle).toBe('epicerie-salee');
    expect(after).toMatchObject({
      lockVersion: 5,
      allergensVerifiedAt: VERIFIED_AT,
      versionPending: false,
    });
    expect(h.notifications.notify).not.toHaveBeenCalled();
    expect(h.mailer.recipeAllergensChanged).not.toHaveBeenCalled();
    expect(result).toEqual({ dishes: 1, reverified: 0, chefs: 0, skipped: 0 });
  });

  it('carries a new name, marks a version pending and keeps the verification', async () => {
    // The renamed entry brings milk: its allergens stay, only who brings them is renamed.
    const butter = { ...BUTTER, ...WITH_MILK };
    const h = harness(
      [butter, CELERY],
      [await saved([butter, CELERY], BUTTER_AND_CELERY)],
    );
    h.change('cat-beurre', { name: 'Beurre doux' });

    await h.service.propagate(['cat-beurre'], 'admin-1');

    const after = h.rows.get('dish-1')!;
    expect((after.ingredients as StoredLineJson[])[0].name).toBe('Beurre doux');
    expect(after).toMatchObject({
      versionPending: true,
      allergensVerifiedAt: VERIFIED_AT,
      allergens: ['milk', 'celery'],
      lockVersion: 5,
    });
    expect(h.notifications.notify).not.toHaveBeenCalled();
  });

  it('repoints the lines of a merged entry and marks a version pending', async () => {
    const butter = { ...BUTTER, ...WITH_MILK };
    const homemade = entryRow({
      id: 'cat-maison',
      name: 'Beurre maison',
      aisle: 'cremerie',
      ...WITH_MILK,
      chefProfileId: 'chef-1',
      status: 'pending',
    });
    const dish = await saved(
      [homemade, CELERY],
      [line('Beurre maison', 'cat-maison'), line('Céleri-rave', 'cat-celeri')],
    );
    const h = harness([butter, homemade, CELERY], [dish]);

    const result = await h.service.propagate(['cat-maison'], 'admin-1', {
      from: 'cat-maison',
      to: 'cat-beurre',
    });

    const after = h.rows.get('dish-1')!;
    expect((after.ingredients as StoredLineJson[])[0]).toMatchObject({
      catalogIngredientId: 'cat-beurre',
      name: 'Beurre',
    });
    expect(after).toMatchObject({
      versionPending: true,
      allergensVerifiedAt: VERIFIED_AT,
    });
    expect(h.notifications.notify).not.toHaveBeenCalled();
    expect(result).toMatchObject({ dishes: 1, reverified: 0 });
  });

  it('finds the lines of the merged entry even when only the target is named', async () => {
    const homemade = entryRow({ id: 'cat-maison', name: 'Beurre maison', ...WITH_MILK });
    const dish = await saved([homemade], [line('Beurre maison', 'cat-maison')]);
    const h = harness([{ ...BUTTER, ...WITH_MILK }, homemade], [dish]);

    await h.service.propagate(['cat-beurre'], 'admin-1', {
      from: 'cat-maison',
      to: 'cat-beurre',
    });

    expect(
      (h.rows.get('dish-1')!.ingredients as StoredLineJson[])[0].catalogIngredientId,
    ).toBe('cat-beurre');
  });

  it("recomputes a Lab's Food recipe without notifying anyone", async () => {
    const recipe = await saved([BUTTER, CELERY], BUTTER_AND_CELERY, {
      chefProfileId: null,
      chefProfile: null,
    });
    const h = harness([BUTTER, CELERY], [recipe]);
    h.change('cat-beurre', WITH_MILK);

    const result = await h.service.propagate(['cat-beurre'], 'admin-1');

    expect(h.rows.get('dish-1')).toMatchObject({
      allergens: ['milk', 'celery'],
      allergensVerifiedAt: null,
      lockVersion: 5,
    });
    expect(h.notifications.notify).not.toHaveBeenCalled();
    expect(h.mailer.recipeAllergensChanged).not.toHaveBeenCalled();
    expect(result).toEqual({ dishes: 1, reverified: 1, chefs: 0, skipped: 0 });
  });

  it('recomputes a dish that was not verified without telling its chef', async () => {
    const dish = await saved([BUTTER, CELERY], BUTTER_AND_CELERY, {
      allergensVerifiedAt: null,
    });
    const h = harness([BUTTER, CELERY], [dish]);
    h.change('cat-beurre', WITH_MILK);

    const result = await h.service.propagate(['cat-beurre'], 'admin-1');

    expect(h.rows.get('dish-1')!.allergens).toEqual(['milk', 'celery']);
    expect(h.notifications.notify).not.toHaveBeenCalled();
    expect(h.mailer.recipeAllergensChanged).not.toHaveBeenCalled();
    expect(result).toEqual({ dishes: 1, reverified: 0, chefs: 0, skipped: 0 });
  });

  it('changes nothing more when replayed', async () => {
    const h = harness(
      [BUTTER, CELERY],
      [await saved([BUTTER, CELERY], BUTTER_AND_CELERY)],
    );
    h.change('cat-beurre', WITH_MILK);
    await h.service.propagate(['cat-beurre'], 'admin-1');
    const once = h.rows.get('dish-1');

    const again = await h.service.propagate(['cat-beurre'], 'admin-1');

    expect(h.meal.update).toHaveBeenCalledTimes(1);
    expect(h.notifications.notify).toHaveBeenCalledTimes(1);
    expect(h.mailer.recipeAllergensChanged).toHaveBeenCalledTimes(1);
    expect(h.rows.get('dish-1')).toBe(once);
    expect(again).toEqual({ dishes: 0, reverified: 0, chefs: 0, skipped: 0 });
  });

  it('writes nothing for a dish already stamped from the entry as it is', async () => {
    const h = harness(
      [BUTTER, CELERY],
      [await saved([BUTTER, CELERY], BUTTER_AND_CELERY)],
    );

    await h.service.propagate(['cat-beurre'], 'admin-1');

    expect(h.meal.update).not.toHaveBeenCalled();
  });

  it('records one audit entry with the figures', async () => {
    const h = harness(
      [BUTTER, CELERY],
      [await saved([BUTTER, CELERY], BUTTER_AND_CELERY)],
    );
    h.change('cat-beurre', WITH_MILK);

    await h.service.propagate(['cat-beurre'], 'admin-1');

    expect(h.audit.record).toHaveBeenCalledTimes(1);
    expect(h.audit.record).toHaveBeenCalledWith({
      actorType: 'admin',
      actorUserId: 'admin-1',
      action: 'catalog_ingredient.propagated',
      subjectType: 'catalog_ingredient',
      subjectId: 'cat-beurre',
      metadata: {
        entryIds: ['cat-beurre'],
        dishes: 1,
        reverified: 1,
        chefs: 1,
        skipped: 0,
      },
    });
  });

  it('sends the e-mails at best: a Brevo failure undoes nothing', async () => {
    const h = harness(
      [BUTTER, CELERY],
      [await saved([BUTTER, CELERY], BUTTER_AND_CELERY)],
    );
    h.change('cat-beurre', WITH_MILK);
    h.mailer.recipeAllergensChanged.mockRejectedValue(new Error('Brevo is down'));

    const result = await h.service.propagate(['cat-beurre'], 'admin-1');

    expect(result).toEqual({ dishes: 1, reverified: 1, chefs: 1, skipped: 0 });
    expect(h.rows.get('dish-1')!.allergensVerifiedAt).toBeNull();
    expect(h.notifications.notify).toHaveBeenCalledTimes(1);
    expect(h.audit.record).toHaveBeenCalledTimes(1);
  });

  // Ruling R12: a chef's save between the read and the write moves `lockVersion` on.
  it('reads a dish again and retries once when a chef saved it meanwhile', async () => {
    const h = harness(
      [BUTTER, CELERY],
      [await saved([BUTTER, CELERY], BUTTER_AND_CELERY)],
    );
    h.change('cat-beurre', WITH_MILK);
    h.chefSavesMeanwhile();

    const result = await h.service.propagate(['cat-beurre'], 'admin-1');

    expect(h.meal.update).toHaveBeenCalledTimes(2);
    expect(h.meal.update.mock.calls[1][0].where).toEqual({
      id: 'dish-1',
      lockVersion: 5,
    });
    expect(h.rows.get('dish-1')).toMatchObject({
      lockVersion: 6,
      allergensVerifiedAt: null,
    });
    expect(h.notifications.notify).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ dishes: 1, reverified: 1, chefs: 1, skipped: 0 });
  });

  it('skips a dish saved meanwhile twice in a row, and counts it', async () => {
    const h = harness(
      [BUTTER, CELERY],
      [await saved([BUTTER, CELERY], BUTTER_AND_CELERY)],
    );
    h.change('cat-beurre', WITH_MILK);
    h.chefSavesMeanwhile();
    h.chefSavesMeanwhile();

    const result = await h.service.propagate(['cat-beurre'], 'admin-1');

    expect(h.meal.update).toHaveBeenCalledTimes(2);
    expect(h.notifications.notify).not.toHaveBeenCalled();
    expect(h.mailer.recipeAllergensChanged).not.toHaveBeenCalled();
    expect(result).toEqual({ dishes: 0, reverified: 0, chefs: 0, skipped: 1 });
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ skipped: 1 }) }),
    );
  });

  it('lets any other error through', async () => {
    const h = harness(
      [BUTTER, CELERY],
      [await saved([BUTTER, CELERY], BUTTER_AND_CELERY)],
    );
    h.change('cat-beurre', WITH_MILK);
    h.meal.update.mockRejectedValueOnce(new Error('connection lost'));

    await expect(h.service.propagate(['cat-beurre'], 'admin-1')).rejects.toThrow(
      'connection lost',
    );
    expect(h.meal.update).toHaveBeenCalledTimes(1);
  });
});
