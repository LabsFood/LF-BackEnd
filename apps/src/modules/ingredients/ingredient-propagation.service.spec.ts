import { NotFoundException } from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { MealStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DishesMailer } from '../dishes/dishes.mailer';
import { composeLines, compositionColumns } from '../dishes/dishes.service';
import { readLines } from '../dishes/domain/recipe-lines.rules';
import { dishRow, entryRow } from '../dishes/dishes.test-helpers';
import { NotificationsService } from '../notifications/notifications.service';
import { LineToStamp } from './composition';
import {
  IngredientPropagationService,
  mergedInto,
} from './ingredient-propagation.service';
import { IngredientsService } from './ingredients.service';

type Entry = ReturnType<typeof entryRow>;
type Owner = { userId: string; user: { email: string; fullName: string | null } };
type Dish = ReturnType<typeof dishRow> & { chefProfile: Owner | null };
type StoredLineJson = { name: string; aisle: string | null; catalogIngredientId: string };

const VERIFIED_AT = new Date('2026-11-01T09:00:00.000Z');
const ADMIN = { type: 'admin' as const, userId: 'admin-1' };

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

/**
 * Answers by id, as `entriesFor` reads the list, or by merge target, as the
 * propagation looks for entries merged into the ones it carries.
 */
const findEntries = (entries: () => Entry[]) =>
  jest.fn(
    async ({
      where,
    }: {
      where: {
        id?: { in: string[] };
        mergedIntoId?: { in: string[] };
        status?: string;
      };
    }) =>
      entries().filter((entry) =>
        where.id
          ? where.id.in.includes(entry.id)
          : !!entry.mergedIntoId &&
            !!where.mergedIntoId?.in.includes(entry.mergedIntoId) &&
            (!where.status || entry.status === where.status),
      ),
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
  const catalogIngredient = {
    findMany: findEntries(() => list),
    findUnique: jest.fn(
      async ({ where }: { where: { id: string } }) =>
        list.find((entry) => entry.id === where.id) ?? null,
    ),
  };
  const client = { meal, catalogIngredient };
  const $transaction = jest.fn(async (work: (tx: typeof client) => Promise<unknown>) =>
    work(client),
  );
  const prisma = { ...client, $transaction } as unknown as PrismaService;
  const notifications = { notify: jest.fn(async (..._args: unknown[]) => ({})) };
  const mailer = {
    recipeAllergensChanged: jest.fn(async (_input: object) => ({ sent: true })),
  };
  const audit = { record: jest.fn(async (_entry: object) => undefined) };
  const service = new IngredientPropagationService(
    prisma,
    notifications as unknown as NotificationsService,
    mailer as unknown as DishesMailer,
    audit as unknown as AuditService,
  );
  const change = (id: string, over: Partial<Entry>) => {
    list = list.map((entry) => (entry.id === id ? { ...entry, ...over } : entry));
  };
  /**
   * A save lands between the propagation's read and its write. A name or
   * description autosave sends no recipe: it moves `lockVersion` on without
   * recomposing, so the dish stays stale.
   */
  const chefSavesMeanwhile = () =>
    meal.findUnique.mockImplementationOnce(async ({ where }) => {
      const row = rows.get(where.id)!;
      rows.set(row.id, { ...row, lockVersion: row.lockVersion + 1 });
      return row;
    });
  /** A save that sends the recipe recomposes the dish from the entry as it stands. */
  const savedFreshMeanwhile = () =>
    meal.findUnique.mockImplementationOnce(async ({ where }) => {
      const row = rows.get(where.id)!;
      const composed = await composeLines(
        prisma,
        row as never,
        {},
        readLines(row.ingredients),
      );
      rows.set(row.id, {
        ...row,
        ...compositionColumns(composed),
        classification: composed.classification,
        lockVersion: row.lockVersion + 1,
      } as Dish);
      return row;
    });
  /**
   * The chef confirms the allergens between the propagation's read and its write.
   * A confirmation never moves `lockVersion` (Recettes §4.9), so the guard misses it.
   */
  const chefConfirmsMeanwhile = () =>
    meal.findUnique.mockImplementationOnce(async ({ where }) => {
      const row = rows.get(where.id)!;
      rows.set(row.id, { ...row, allergensVerifiedAt: new Date() });
      return row;
    });
  return {
    prisma,
    rows,
    meal,
    client,
    notifications,
    mailer,
    audit,
    service,
    change,
    chefSavesMeanwhile,
    savedFreshMeanwhile,
    chefConfirmsMeanwhile,
  };
}

describe('IngredientPropagationService.propagate (Recettes §7.3)', () => {
  it('finds the dishes with the array_contains query, one condition per entry', async () => {
    const h = harness([BUTTER], []);

    await h.service.propagate(['cat-beurre', 'cat-celeri'], ADMIN);

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

    const result = await h.service.propagate(['cat-beurre'], ADMIN);

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
    expect(result).toEqual({ dishes: 1, reverified: 1, chefs: 1, skipped: 0, failed: 0 });
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

    const result = await h.service.propagate(['cat-beurre'], ADMIN);

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
    expect(result).toEqual({ dishes: 4, reverified: 4, chefs: 2, skipped: 0, failed: 0 });
  });

  it('carries a new aisle onto the lines and keeps the verification, telling nobody', async () => {
    const h = harness(
      [BUTTER, CELERY],
      [await saved([BUTTER, CELERY], BUTTER_AND_CELERY)],
    );
    h.change('cat-beurre', { aisle: 'epicerie-salee' });

    const result = await h.service.propagate(['cat-beurre'], ADMIN);

    const after = h.rows.get('dish-1')!;
    expect((after.ingredients as StoredLineJson[])[0].aisle).toBe('epicerie-salee');
    expect(after).toMatchObject({
      lockVersion: 5,
      allergensVerifiedAt: VERIFIED_AT,
      versionPending: false,
    });
    expect(h.notifications.notify).not.toHaveBeenCalled();
    expect(h.mailer.recipeAllergensChanged).not.toHaveBeenCalled();
    expect(result).toEqual({ dishes: 1, reverified: 0, chefs: 0, skipped: 0, failed: 0 });
  });

  it('carries a new name, marks a version pending and keeps the verification', async () => {
    // The renamed entry brings milk: its allergens stay, only who brings them is renamed.
    const butter = { ...BUTTER, ...WITH_MILK };
    const h = harness(
      [butter, CELERY],
      [await saved([butter, CELERY], BUTTER_AND_CELERY)],
    );
    h.change('cat-beurre', { name: 'Beurre doux' });

    await h.service.propagate(['cat-beurre'], ADMIN);

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

    const result = await h.service.propagate(['cat-maison'], ADMIN, {
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

    await h.service.propagate(['cat-beurre'], ADMIN, {
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

    const result = await h.service.propagate(['cat-beurre'], ADMIN);

    expect(h.rows.get('dish-1')).toMatchObject({
      allergens: ['milk', 'celery'],
      allergensVerifiedAt: null,
      lockVersion: 5,
    });
    expect(h.notifications.notify).not.toHaveBeenCalled();
    expect(h.mailer.recipeAllergensChanged).not.toHaveBeenCalled();
    expect(result).toEqual({ dishes: 1, reverified: 1, chefs: 0, skipped: 0, failed: 0 });
  });

  it('recomputes a dish that was not verified without telling its chef', async () => {
    const dish = await saved([BUTTER, CELERY], BUTTER_AND_CELERY, {
      allergensVerifiedAt: null,
    });
    const h = harness([BUTTER, CELERY], [dish]);
    h.change('cat-beurre', WITH_MILK);

    const result = await h.service.propagate(['cat-beurre'], ADMIN);

    expect(h.rows.get('dish-1')!.allergens).toEqual(['milk', 'celery']);
    expect(h.notifications.notify).not.toHaveBeenCalled();
    expect(h.mailer.recipeAllergensChanged).not.toHaveBeenCalled();
    expect(result).toEqual({ dishes: 1, reverified: 0, chefs: 0, skipped: 0, failed: 0 });
  });

  it('changes nothing more when replayed', async () => {
    const h = harness(
      [BUTTER, CELERY],
      [await saved([BUTTER, CELERY], BUTTER_AND_CELERY)],
    );
    h.change('cat-beurre', WITH_MILK);
    await h.service.propagate(['cat-beurre'], ADMIN);
    const once = h.rows.get('dish-1');

    const again = await h.service.propagate(['cat-beurre'], ADMIN);

    expect(h.meal.update).toHaveBeenCalledTimes(1);
    expect(h.notifications.notify).toHaveBeenCalledTimes(1);
    expect(h.mailer.recipeAllergensChanged).toHaveBeenCalledTimes(1);
    expect(h.rows.get('dish-1')).toBe(once);
    expect(again).toEqual({ dishes: 0, reverified: 0, chefs: 0, skipped: 0, failed: 0 });
  });

  it('writes nothing for a dish already stamped from the entry as it is', async () => {
    const h = harness(
      [BUTTER, CELERY],
      [await saved([BUTTER, CELERY], BUTTER_AND_CELERY)],
    );

    await h.service.propagate(['cat-beurre'], ADMIN);

    expect(h.meal.update).not.toHaveBeenCalled();
  });

  it('records one audit entry with the figures', async () => {
    const h = harness(
      [BUTTER, CELERY],
      [await saved([BUTTER, CELERY], BUTTER_AND_CELERY)],
    );
    h.change('cat-beurre', WITH_MILK);

    await h.service.propagate(['cat-beurre'], ADMIN);

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
        failed: 0,
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

    const result = await h.service.propagate(['cat-beurre'], ADMIN);

    expect(result).toEqual({ dishes: 1, reverified: 1, chefs: 1, skipped: 0, failed: 0 });
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

    const result = await h.service.propagate(['cat-beurre'], ADMIN);

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
    expect(result).toEqual({ dishes: 1, reverified: 1, chefs: 1, skipped: 0, failed: 0 });
  });

  // Ruling R12b: after a second conflict the dish is read and composed once more.
  it('skips a dish saved twice meanwhile when the second save left it fresh', async () => {
    const h = harness(
      [BUTTER, CELERY],
      [await saved([BUTTER, CELERY], BUTTER_AND_CELERY)],
    );
    h.change('cat-beurre', WITH_MILK);
    h.chefSavesMeanwhile();
    h.savedFreshMeanwhile();

    const result = await h.service.propagate(['cat-beurre'], ADMIN);

    expect(h.meal.update).toHaveBeenCalledTimes(2);
    expect(h.rows.get('dish-1')!.allergens).toEqual(['milk', 'celery']);
    expect(h.notifications.notify).not.toHaveBeenCalled();
    expect(h.mailer.recipeAllergensChanged).not.toHaveBeenCalled();
    expect(result).toEqual({ dishes: 0, reverified: 0, chefs: 0, skipped: 1, failed: 0 });
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ skipped: 1 }) }),
    );
  });

  it('counts as failed a dish two saves without a recipe left stale, for a replay', async () => {
    const h = harness(
      [BUTTER, CELERY],
      [await saved([BUTTER, CELERY], BUTTER_AND_CELERY)],
    );
    h.change('cat-beurre', WITH_MILK);
    // Two name autosaves: `lockVersion` moves, the allergens stay as they were.
    h.chefSavesMeanwhile();
    h.chefSavesMeanwhile();

    const result = await h.service.propagate(['cat-beurre'], ADMIN);

    expect(result).toEqual({ dishes: 0, reverified: 0, chefs: 0, skipped: 0, failed: 1 });
    expect(h.rows.get('dish-1')!.allergens).toEqual(['celery']);

    // The admin's replay picks it up.
    const replay = await h.service.propagate(['cat-beurre'], ADMIN);
    expect(replay).toMatchObject({ dishes: 1, reverified: 1, failed: 0 });
    expect(h.rows.get('dish-1')!.allergens).toEqual(['milk', 'celery']);
  });

  // Critical: a confirmation never moves `lockVersion`, so the guard cannot see it.
  it('clears a verification confirmed between its read and its write', async () => {
    const dish = await saved([BUTTER, CELERY], BUTTER_AND_CELERY, {
      allergensVerifiedAt: null,
    });
    const h = harness([BUTTER, CELERY], [dish]);
    h.change('cat-beurre', WITH_MILK);
    h.chefConfirmsMeanwhile();

    const result = await h.service.propagate(['cat-beurre'], ADMIN);

    expect(h.meal.update).toHaveBeenCalledTimes(1);
    expect(h.meal.update.mock.calls[0][0].data).toMatchObject({
      allergensVerifiedAt: null,
    });
    // Never verified for allergens the chef did not see.
    expect(h.rows.get('dish-1')).toMatchObject({
      allergens: ['milk', 'celery'],
      allergensVerifiedAt: null,
    });
    // The read saw no verification: nothing to tell, nothing counted.
    expect(result).toEqual({ dishes: 1, reverified: 0, chefs: 0, skipped: 0, failed: 0 });
  });

  // A line merged into the changed entry, never repointed since.
  it('also finds the lines still linking an entry merged into the changed one', async () => {
    const homemade = entryRow({
      id: 'cat-maison',
      name: 'Beurre maison',
      chefProfileId: 'chef-1',
      status: 'pending',
    });
    const dish = await saved(
      [homemade, CELERY],
      [line('Beurre maison', 'cat-maison'), line('Céleri-rave', 'cat-celeri')],
    );
    const merged = { ...homemade, status: 'merged', mergedIntoId: 'cat-beurre' };
    const h = harness([{ ...BUTTER, ...WITH_MILK }, merged, CELERY], [dish]);

    const result = await h.service.propagate(['cat-beurre'], ADMIN);

    expect(h.meal.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { ingredients: { array_contains: [{ catalogIngredientId: 'cat-beurre' }] } },
          { ingredients: { array_contains: [{ catalogIngredientId: 'cat-maison' }] } },
        ],
      },
      select: { id: true },
    });
    const after = h.rows.get('dish-1')!;
    expect((after.ingredients as StoredLineJson[])[0]).toMatchObject({
      catalogIngredientId: 'cat-beurre',
      name: 'Beurre',
    });
    expect(after).toMatchObject({
      allergens: ['milk', 'celery'],
      allergensVerifiedAt: null,
      versionPending: true,
    });
    expect(result).toMatchObject({ dishes: 1, reverified: 1 });
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          entryIds: ['cat-beurre'],
          mergedIds: ['cat-maison'],
        }),
      }),
    );
  });

  // Merge recovery: a dish that `failed` during a merge still links the merged id.
  // The replay on the target (no remap) finds it through `mergedInto` and repoints it,
  // even when the two entries read exactly alike (the line's id alone differs).
  it('repoints a dish a merge left on the merged id, replaying on the target alone', async () => {
    const twin = {
      ...BUTTER,
      id: 'cat-maison',
      chefProfileId: 'chef-1',
      status: 'merged',
      mergedIntoId: 'cat-beurre',
    };
    // Saved while the twin was pending: same name, aisle and allergens as the target.
    const dish = await saved(
      [{ ...twin, status: 'pending', mergedIntoId: null }],
      [line('Beurre', 'cat-maison')],
    );
    const h = harness([BUTTER, twin], [dish]);

    const result = await h.service.propagate(['cat-beurre'], ADMIN);

    expect(
      (h.rows.get('dish-1')!.ingredients as StoredLineJson[])[0].catalogIngredientId,
    ).toBe('cat-beurre');
    expect(result).toMatchObject({ dishes: 1, failed: 0 });

    // And the replay after it writes nothing more.
    const again = await h.service.propagate(['cat-beurre'], ADMIN);
    expect(again).toMatchObject({ dishes: 0, failed: 0 });
  });

  it('keeps a merge apart from the ids carried in the audit entry', async () => {
    const h = harness([{ ...BUTTER, ...WITH_MILK }], []);

    await h.service.propagate(['cat-beurre'], ADMIN, {
      from: 'cat-maison',
      to: 'cat-beurre',
    });

    const { metadata } = h.audit.record.mock.calls[0][0] as {
      metadata: Record<string, unknown>;
    };
    expect(metadata.entryIds).toEqual(['cat-beurre']);
    expect(metadata.remap).toEqual({ from: 'cat-maison', to: 'cat-beurre' });
  });

  // Ruling R7: a row written before the socle, its allergens declared by hand.
  it('keeps the hand-declared allergens of a legacy row, as added', async () => {
    const tomato = entryRow({ id: 'cat-tomate', name: 'Tomate' });
    const legacy = {
      chefProfile: MARIE,
      ...dishRow({
        // Never stamped: no `allergens` on the line, milk declared by hand.
        ingredients: [
          { name: 'tomates', qty: 2, unit: 'kg', catalogIngredientId: 'cat-tomate' },
        ],
        allergens: ['milk'],
        allergensNone: false,
        addedAllergens: [],
        status: MealStatus.published,
        allergensVerifiedAt: VERIFIED_AT,
        lockVersion: 4,
      }),
    } as Dish;
    const h = harness([tomato], [legacy]);

    await h.service.propagate(['cat-tomate'], ADMIN);

    expect(h.rows.get('dish-1')).toMatchObject({
      allergens: ['milk'],
      addedAllergens: ['milk'],
      allergensVerifiedAt: VERIFIED_AT,
      ingredients: [
        expect.objectContaining({ name: 'Tomate', allergens: [], incomplete: false }),
      ],
    });
    expect(h.notifications.notify).not.toHaveBeenCalled();
  });

  it('drops an allergen the entry no longer has, and asks the chef to verify again', async () => {
    const butter = { ...BUTTER, ...WITH_MILK };
    const h = harness(
      [butter, CELERY],
      [await saved([butter, CELERY], BUTTER_AND_CELERY)],
    );
    h.change('cat-beurre', { allergens: [], allergensNone: true });

    const result = await h.service.propagate(['cat-beurre'], ADMIN);

    expect(h.rows.get('dish-1')).toMatchObject({
      allergens: ['celery'],
      allergensVerifiedAt: null,
    });
    expect(h.notifications.notify).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ dishes: 1, reverified: 1, chefs: 1 });
  });

  // Lab's Food writes move `lockVersion` too, so the guard sees them.
  it("reads a Lab's Food recipe again when an admin saved it meanwhile, then writes", async () => {
    const recipe = await saved([BUTTER, CELERY], BUTTER_AND_CELERY, {
      chefProfileId: null,
      chefProfile: null,
    });
    const h = harness([BUTTER, CELERY], [recipe]);
    h.change('cat-beurre', WITH_MILK);
    h.chefSavesMeanwhile();

    const result = await h.service.propagate(['cat-beurre'], ADMIN);

    expect(h.meal.update).toHaveBeenCalledTimes(2);
    expect(h.meal.update.mock.calls[1][0].where).toEqual({
      id: 'dish-1',
      lockVersion: 5,
    });
    expect(h.rows.get('dish-1')).toMatchObject({
      allergens: ['milk', 'celery'],
      lockVersion: 6,
    });
    expect(result).toMatchObject({ dishes: 1, skipped: 0, failed: 0 });
  });

  it('sends at most ten e-mails at a time', async () => {
    const owners = Array.from({ length: 23 }, (_, i) => ({
      userId: `user-${i}`,
      user: { email: `chef-${i}@example.com`, fullName: null },
    }));
    const dishes = await Promise.all(
      owners.map((owner, i) =>
        saved([BUTTER, CELERY], BUTTER_AND_CELERY, {
          id: `dish-${i}`,
          chefProfileId: `chef-${i}`,
          chefProfile: owner,
        }),
      ),
    );
    const h = harness([BUTTER, CELERY], dishes);
    h.change('cat-beurre', WITH_MILK);
    let inFlight = 0;
    let most = 0;
    h.mailer.recipeAllergensChanged.mockImplementation(async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight -= 1;
      return { sent: true };
    });

    const result = await h.service.propagate(['cat-beurre'], ADMIN);

    expect(result.chefs).toBe(23);
    expect(h.mailer.recipeAllergensChanged).toHaveBeenCalledTimes(23);
    expect(most).toBe(10);
  });

  // Ruling R14: no dish is left with stale allergens because another one failed.
  it('carries on past a dish that fails, counts it, and still e-mails for the others', async () => {
    const dishes = await Promise.all(
      ['dish-1', 'dish-2', 'dish-3'].map((id) =>
        saved([BUTTER, CELERY], BUTTER_AND_CELERY, { id }),
      ),
    );
    const h = harness([BUTTER, CELERY], dishes);
    h.change('cat-beurre', WITH_MILK);
    const write = h.meal.update.getMockImplementation()!;
    h.meal.update.mockImplementation(async (args) => {
      if (args.where.id === 'dish-2') throw new Error('deadlock detected');
      return write(args);
    });

    const result = await h.service.propagate(['cat-beurre'], ADMIN);

    expect(result).toEqual({ dishes: 2, reverified: 2, chefs: 1, skipped: 0, failed: 1 });
    expect(h.rows.get('dish-1')!.allergens).toEqual(['milk', 'celery']);
    expect(h.rows.get('dish-3')!.allergens).toEqual(['milk', 'celery']);
    // The failed one is as it was: a replay finds it still to carry.
    expect(h.rows.get('dish-2')).toMatchObject({
      allergens: ['celery'],
      allergensVerifiedAt: VERIFIED_AT,
      lockVersion: 4,
    });
    expect(h.notifications.notify).toHaveBeenCalledTimes(2);
    expect(h.mailer.recipeAllergensChanged).toHaveBeenCalledWith({
      email: 'marie@example.com',
      name: 'Marie Dupont',
      dishCount: 2,
    });
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ failed: 1 }) }),
    );
  });

  it('records the actor as given', async () => {
    const h = harness(
      [BUTTER, CELERY],
      [await saved([BUTTER, CELERY], BUTTER_AND_CELERY)],
    );
    h.change('cat-beurre', WITH_MILK);

    await h.service.propagate(['cat-beurre'], { type: 'chef', userId: 'user-1' });

    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: 'chef', actorUserId: 'user-1' }),
    );
  });
});

describe('IngredientsService.propagate, the admin replay (ruling R14)', () => {
  const ingredients = (h: ReturnType<typeof harness>) =>
    new IngredientsService(h.prisma, h.audit as unknown as AuditService, h.service, {
      notify: jest.fn(),
    } as unknown as NotificationsService);

  it('carries the entry into the recipes again, and a second replay writes nothing', async () => {
    const h = harness(
      [BUTTER, CELERY],
      [await saved([BUTTER, CELERY], BUTTER_AND_CELERY)],
    );
    // A run cut short: the entry changed, the dish was never carried.
    h.change('cat-beurre', WITH_MILK);

    const first = await ingredients(h).propagate('cat-beurre', 'admin-1');
    const second = await ingredients(h).propagate('cat-beurre', 'admin-1');

    expect(first).toEqual({ dishes: 1, reverified: 1, chefs: 1, skipped: 0, failed: 0 });
    expect(h.rows.get('dish-1')!.allergens).toEqual(['milk', 'celery']);
    expect(second).toEqual({ dishes: 0, reverified: 0, chefs: 0, skipped: 0, failed: 0 });
    expect(h.meal.update).toHaveBeenCalledTimes(1);
    expect(h.notifications.notify).toHaveBeenCalledTimes(1);
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: 'admin', actorUserId: 'admin-1' }),
    );
  });

  it('answers 404 for an unknown ingredient and carries nothing', async () => {
    const h = harness([BUTTER], []);

    await expect(ingredients(h).propagate('nope', 'admin-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(h.meal.findMany).not.toHaveBeenCalled();
    expect(h.audit.record).not.toHaveBeenCalled();
  });
});

// Task 14 carry-over: the hop `entriesFor` follows needs a merged status too.
describe('mergedInto (Recettes §7.3)', () => {
  it('finds the entries merged into the ids, by status and target', async () => {
    const findMany = jest.fn(async (_args: unknown) => [{ id: 'old' }, { id: 'cat-1' }]);
    const db = { catalogIngredient: { findMany } } as unknown as PrismaService;

    await expect(mergedInto(db, ['cat-1'])).resolves.toEqual(['old']);

    expect(findMany).toHaveBeenCalledWith({
      where: { mergedIntoId: { in: ['cat-1'] }, status: 'merged' },
      select: { id: true },
    });
  });
});
