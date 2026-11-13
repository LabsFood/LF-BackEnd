import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import {
  Meal,
  MealRecipeVersion,
  Prisma,
  ShoppingItem,
} from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { aislesInForce } from '../platform-settings/recipe-lists';
import { displayQuantity } from '../dishes/domain/units.rules';
import {
  aggregate,
  applyCorrections,
  diffCorrections,
  groupByAisle,
  Line,
  lineKey,
  roundLines,
  scale,
} from '../dishes/domain/recipes.rules';
import {
  ClientMark,
  MarkInput,
  marksApply,
  submitRefusal,
  toMarks,
  withMarks,
} from './domain/shopping-list.rules';

/** One booked dish with the recipe version it cooks from. */
export interface PinnedRecipe {
  mealId: string;
  meal: Meal;
  portions: number;
  recipe: MealRecipeVersion;
}

/** Recettes §4.12: a "to taste" line has no number, it reads "selon le goût". */
const formatQuantity = (line: Line) =>
  line.unit === 'to_taste'
    ? displayQuantity(null, line.unit)
    : `${line.qty} ${line.unit}`.trim();

const toLine = (item: ShoppingItem): Line => ({
  name: item.name,
  qty: item.qty ?? 0,
  unit: item.unit ?? '',
  aisle: item.aisle,
});

/** The list as the chef left it: computed lines with their corrections applied. */
const linesOf = (items: ShoppingItem[]) =>
  applyCorrections(
    items.filter((item) => !item.edited).map(toLine),
    items
      .filter((item) => item.edited)
      .map((item) => ({ ...toLine(item), removed: item.removed })),
  );

/**
 * A prestation's shopping list (FLOW-02 §7), computed from the recipes it cooks
 * from: scaled to the portions booked, the same ingredient in the same unit added
 * up, grouped by aisle. The batch cooker's corrections are stored beside the
 * computed lines and survive every recalculation; a reset drops them.
 *
 * Every dish booked counts, whether a batch cooker or Lab's Food wrote it: no
 * owner filter here, on purpose.
 */
@Injectable()
export class ShoppingListsService {
  constructor(private readonly prisma: PrismaService) {}

  async getByBookingId(bookingId: string) {
    return this.prisma.shoppingList.findUnique({
      where: { bookingId },
      include: { items: { orderBy: [{ aisle: 'asc' }, { name: 'asc' }] } },
    });
  }

  /**
   * Pins each booked dish to the recipe version it cooks from, keeping that
   * version's content (§9.2), and the dish's allergens of that moment (Recettes
   * lot 3, LF-0268). Unpinned dishes take their current version; with `repin`,
   * every dish moves to its current version. Returns what is pinned now.
   *
   * A write of the menu (booking created or its dishes changed, a conflicting dish
   * replaced) pins in its own transaction, passed as `db`: a recipe the chef
   * edits afterwards never reaches the prestation. The recipe sheet and the
   * shopping list call it on first use too, which pins whatever is still
   * unpinned: a booking from before lot 3, or a pin that failed at creation.
   */
  async pinRecipes(
    bookingId: string,
    options: { repin?: boolean; db?: Prisma.TransactionClient } = {},
  ): Promise<PinnedRecipe[]> {
    const db = options.db ?? this.prisma;
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      include: { bookingMeals: { include: { meal: true } } },
    });
    if (!booking) throw new NotFoundException('Booking not found.');

    const toPin = booking.bookingMeals.filter(
      (bm) => options.repin || bm.recipeVersion === null,
    );
    if (toPin.length) {
      const pinnedAt = new Date();
      const writes = (tx: Prisma.TransactionClient) =>
        toPin.reduce(
          (done, { meal }) =>
            done.then(async () => {
              await tx.mealRecipeVersion.upsert({
                where: {
                  mealId_version: { mealId: meal.id, version: meal.recipeVersion },
                },
                create: {
                  mealId: meal.id,
                  version: meal.recipeVersion,
                  portions: meal.portions,
                  ingredients: meal.ingredients ?? [],
                  steps: meal.steps ?? [],
                  reheating: meal.reheating ?? Prisma.DbNull,
                  storage: meal.storage ?? Prisma.DbNull,
                },
                // Already kept by an earlier booking: its content never changes.
                update: {},
              });
              await tx.bookingMeal.update({
                where: { bookingId_mealId: { bookingId, mealId: meal.id } },
                data: {
                  recipeVersion: meal.recipeVersion,
                  allergensSnapshot: [...meal.allergens],
                  pinnedAt,
                },
              });
            }),
          Promise.resolve(),
        );
      if (options.db) await writes(options.db);
      else await this.prisma.$transaction((tx) => writes(tx));
    }

    const pinned = booking.bookingMeals.map((bm) => ({
      mealId: bm.mealId,
      meal: bm.meal,
      portions: bm.portions,
      version: toPin.includes(bm) ? bm.meal.recipeVersion : bm.recipeVersion!,
    }));
    if (pinned.length === 0) return [];
    const recipes = await db.mealRecipeVersion.findMany({
      where: { OR: pinned.map(({ mealId, version }) => ({ mealId, version })) },
    });
    return pinned.map(({ version, ...rest }) => {
      const recipe = recipes.find(
        (r) => r.mealId === rest.mealId && r.version === version,
      );
      // Kept by the upsert above, and protected by a RESTRICT foreign key.
      if (!recipe) throw new Error(`Recipe ${rest.mealId} v${version} was not kept.`);
      return { ...rest, recipe };
    });
  }

  /**
   * Recomputes the list from the pinned recipes. Only the computed lines are
   * replaced: the batch cooker's corrections stay.
   */
  async regenerateForBooking(bookingId: string) {
    const lines = await this.computedLines(bookingId);
    await this.locked(bookingId, (tx, listId) => this.replaceComputed(tx, listId, lines));
    return (await this.getByBookingId(bookingId))!;
  }

  /**
   * §7's shape, grouped by aisle, with the exchange with the client (§10.7). Each
   * line carries the client's answer: for the chef and admins only once it answers
   * the list sent last; for the client always, to start again from it after an
   * update.
   */
  async view(bookingId: string, options: { forClient?: boolean } = {}) {
    const list =
      (await this.getByBookingId(bookingId)) ??
      (await this.regenerateForBooking(bookingId));
    const marks =
      options.forClient || marksApply(list)
        ? (list.clientMarks as unknown as ClientMark[])
        : [];
    return {
      generatedAt: list.generatedAt,
      version: list.version,
      sentAt: list.sentAt,
      finalReceivedAt: list.finalReceivedAt,
      groups: groupByAisle(
        withMarks(linesOf(list.items), marks),
        (await aislesInForce(this.prisma)).map((aisle) => aisle.code),
      ),
    };
  }

  /** The batch cooker sends the list as it is now. Each send counts. */
  async send(bookingId: string) {
    if (!(await this.getByBookingId(bookingId)))
      await this.regenerateForBooking(bookingId);
    return this.prisma.shoppingList.update({
      where: { bookingId },
      data: { version: { increment: 1 }, sentAt: new Date() },
      select: { version: true },
    });
  }

  /**
   * Recettes lot 4 (LF-0283, §10.9; decision of 13/11): the menu changed. The list is
   * recomputed, and when the client had already been sent one it goes out again at
   * once, before the deadline only. The client's marks stay on the lines that still
   * ask for the same quantity (`withMarks`). Answers the new send count, or null
   * when nothing was sent again.
   */
  async refreshAfterMenuChange(
    bookingId: string,
    deadline: Date,
  ): Promise<number | null> {
    const before = await this.getByBookingId(bookingId);
    await this.regenerateForBooking(bookingId);
    if (!before || before.version === 0 || new Date() >= deadline) return null;
    return (await this.send(bookingId)).version;
  }

  /**
   * The client's final list: their marks, checked against the list as it is inside
   * the lock. A send that lands meanwhile waits, then makes this answer out of date.
   */
  async submit(
    bookingId: string,
    answer: { version: number; marks: MarkInput[] },
    deadline: Date,
  ) {
    return this.locked(bookingId, async (tx, listId) => {
      const list = await tx.shoppingList.findUniqueOrThrow({
        where: { id: listId },
        include: { items: true },
      });
      const now = new Date();
      const refusal = submitRefusal(list, deadline, now, answer.version);
      if (refusal) throw refusal;
      const marks = toMarks(linesOf(list.items), answer.marks);
      await tx.shoppingList.update({
        where: { id: listId },
        data: {
          clientMarks: marks as unknown as Prisma.InputJsonValue,
          finalReceivedAt: now,
        },
      });
      return { version: list.version, marks: marks.length };
    });
  }

  /**
   * The batch cooker's version of the list. Whatever differs from the recipes is
   * stored as a correction; a computed line left out is struck out. Diffed
   * against the computed lines as they are inside the lock, never a stale copy.
   */
  async correct(bookingId: string, wanted: Line[]) {
    const keys = wanted.map(lineKey);
    const twice = wanted.filter((_, i) => keys.indexOf(keys[i]) !== i);
    if (twice.length) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        message: `Each ingredient once per unit: ${twice.map((l) => `${l.name} (${l.unit})`).join(', ')} is listed twice.`,
      });
    }
    if (!(await this.getByBookingId(bookingId)))
      await this.regenerateForBooking(bookingId);
    await this.locked(bookingId, async (tx, listId) => {
      const computed = (
        await tx.shoppingItem.findMany({
          where: { shoppingListId: listId, edited: false },
        })
      ).map(toLine);
      const corrections = diffCorrections(computed, wanted);
      await tx.shoppingItem.deleteMany({
        where: { shoppingListId: listId, edited: true },
      });
      await tx.shoppingItem.createMany({
        data: corrections.map((c) => ({
          shoppingListId: listId,
          name: c.name,
          qty: c.qty,
          unit: c.unit,
          aisle: c.aisle,
          quantity: formatQuantity(c),
          edited: true,
          removed: c.removed,
        })),
      });
    });
    return this.view(bookingId);
  }

  /** Back to the list the recipes give: every correction dropped. */
  async reset(bookingId: string) {
    const lines = await this.computedLines(bookingId);
    await this.locked(bookingId, async (tx, listId) => {
      await tx.shoppingItem.deleteMany({
        where: { shoppingListId: listId, edited: true },
      });
      await this.replaceComputed(tx, listId, lines);
    });
    return this.view(bookingId);
  }

  /** What the pinned recipes give, scaled to the portions booked and added up. */
  private async computedLines(bookingId: string): Promise<Line[]> {
    const pinned = await this.pinRecipes(bookingId);
    // Recettes §4.12: added up unrounded, rounded once at the end.
    return roundLines(
      aggregate(
        pinned.flatMap((p) => scale(p.recipe.ingredients, p.recipe.portions, p.portions)),
      ),
    );
  }

  private async replaceComputed(
    tx: Prisma.TransactionClient,
    listId: string,
    lines: Line[],
  ) {
    await tx.shoppingItem.deleteMany({
      where: { shoppingListId: listId, edited: false },
    });
    await tx.shoppingItem.createMany({
      data: lines.map((line) => ({
        shoppingListId: listId,
        ...line,
        quantity: formatQuantity(line),
      })),
    });
    await tx.shoppingList.update({
      where: { id: listId },
      data: { generatedAt: new Date() },
    });
  }

  /**
   * One writer per list at a time: the booking's list row is created if missing,
   * then locked for the transaction. Two recalculations at once (two page loads, a
   * double-clicked re-pin) would otherwise both delete and both insert, doubling
   * every line.
   */
  private locked<T>(
    bookingId: string,
    work: (tx: Prisma.TransactionClient, listId: string) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.shoppingList.createMany({ data: [{ bookingId }], skipDuplicates: true });
      const [row] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM shopping_lists WHERE booking_id = ${bookingId}::uuid FOR UPDATE`;
      return work(tx, row.id);
    });
  }
}
