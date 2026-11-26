import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';

import {
  Meal,
  MealRecipeVersion,
  Prisma,
  ShoppingItem,
} from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MessagingEventsService } from '../messaging/services/messaging-events.service';
import { aislesInForce } from '../platform-settings/recipe-lists';
import { displayQuantity } from '../dishes/domain/units.rules';
import {
  aggregate,
  applyCorrections,
  diffCorrections,
  fold,
  groupByAisle,
  Line,
  lineKey,
  roundLines,
  scale,
} from '../dishes/domain/recipes.rules';
import {
  applyReplies,
  changesSinceSent,
  ChefReply,
  ClientMark,
  keptMarks,
  ListLine,
  MarkInput,
  mergeMarks,
  quietSince,
  ReplyInput,
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
export const formatQuantity = (line: Pick<Line, 'qty' | 'unit'>) =>
  line.unit === 'to_taste'
    ? displayQuantity(null, line.unit)
    : `${line.qty} ${line.unit}`.trim();

const toLine = (item: ShoppingItem): Line => ({
  name: item.name,
  qty: item.qty ?? 0,
  unit: item.unit ?? '',
  aisle: item.aisle,
  ...(item.optional ? { optional: true as const } : {}),
  ...(item.providedByChef ? { providedByChef: true } : {}),
});

/** The list as the chef left it: computed lines with their corrections applied. */
export const linesOf = (items: ShoppingItem[]) =>
  applyCorrections(
    items.filter((item) => !item.edited).map(toLine),
    items
      .filter((item) => item.edited)
      .map((item) => ({ ...toLine(item), removed: item.removed })),
  );

type ListRow = {
  version: number;
  sentLines: Prisma.JsonValue | null;
  clientMarks: Prisma.JsonValue;
  marksVersion: number | null;
  chefReplies: Prisma.JsonValue;
};

/** The lines the client reads: those last sent, never the chef's work in progress. */
export const sentLinesOf = (list: Pick<ListRow, 'sentLines'>) =>
  (list.sentLines ?? []) as unknown as ListLine[];

/** The client's marks, if they answer the version sent last. */
const currentMarks = (list: ListRow) =>
  list.marksVersion === list.version ? (list.clientMarks as unknown as ClientMark[]) : [];

const repliesOf = (list: Pick<ListRow, 'chefReplies'>) =>
  (list.chefReplies ?? []) as unknown as ChefReply[];

const json = (value: unknown) => value as Prisma.InputJsonValue;

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
  private readonly logger = new Logger(ShoppingListsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly events?: MessagingEventsService,
  ) {}

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
   * §7's shape, grouped by aisle, with the exchange with the client (§10.7). The
   * client's marks show on each line as soon as they answer the version sent last.
   *
   * The chef and admins read the live list, with what changed since the last send.
   * The client reads only what was sent: nothing before the first send, then that
   * snapshot, the lines the batch cooker brings set apart and not to be ticked.
   */
  async view(bookingId: string, options: { forClient?: boolean } = {}) {
    const list =
      (await this.getByBookingId(bookingId)) ??
      (await this.regenerateForBooking(bookingId));
    const order = (await aislesInForce(this.prisma)).map((aisle) => aisle.code);
    const marks = currentMarks(list);
    const replies = repliesOf(list);
    const common = {
      generatedAt: list.generatedAt,
      version: list.version,
      sentAt: list.sentAt,
      finalReceivedAt: list.finalReceivedAt,
      marksUpdatedAt: list.marksVersion === list.version ? list.marksUpdatedAt : null,
    };

    if (options.forClient) {
      const sent = sentLinesOf(list);
      return {
        ...common,
        groups: groupByAisle(
          withMarks(
            sent.filter((line) => !line.providedByChef),
            marks,
            replies,
          ),
          order,
        ),
        providedByChef: sent.filter((line) => line.providedByChef),
      };
    }

    const live = linesOf(list.items);
    const changes = list.version > 0 ? changesSinceSent(sentLinesOf(list), live) : null;
    return {
      ...common,
      pendingChanges: !!changes && Object.values(changes).some((c) => c.length > 0),
      changesSinceSent: changes,
      groups: groupByAisle(
        withMarks(live, marks, replies).map((line) => ({
          ...line,
          providedByChef: !!line.providedByChef,
        })),
        order,
      ),
    };
  }

  /**
   * The batch cooker sends the list as it is now: it becomes what the client reads
   * (`sentLines`). Each send counts. The client's marks carry over to the lines
   * that still ask for the same quantity; the others fall.
   */
  async send(bookingId: string) {
    if (!(await this.getByBookingId(bookingId)))
      await this.regenerateForBooking(bookingId);
    return this.locked(bookingId, async (tx, listId) => {
      const list = await tx.shoppingList.findUniqueOrThrow({
        where: { id: listId },
        include: { items: true },
      });
      const sent = linesOf(list.items);
      const version = list.version + 1;
      const marks = keptMarks(sent, currentMarks(list));
      await tx.shoppingList.update({
        where: { id: listId },
        data: {
          version,
          sentAt: new Date(),
          sentLines: json(sent),
          clientMarks: json(marks),
          marksVersion: marks.length ? version : null,
        },
      });
      return { version };
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
   * The client's final list: their marks, checked against the version sent, inside
   * the lock. A send that lands meanwhile waits, then makes this answer out of date.
   */
  async submit(
    bookingId: string,
    answer: { version: number; marks: MarkInput[] },
    deadline: Date,
  ) {
    return this.locked(bookingId, async (tx, listId) => {
      const list = await tx.shoppingList.findUniqueOrThrow({ where: { id: listId } });
      const now = new Date();
      const refusal = submitRefusal(list, deadline, now, answer.version);
      if (refusal) throw refusal;
      const marks = toMarks(sentLinesOf(list), answer.marks);
      await tx.shoppingList.update({
        where: { id: listId },
        data: {
          clientMarks: json(marks),
          marksVersion: list.version,
          marksUpdatedAt: now,
          finalReceivedAt: now,
        },
      });
      return { version: list.version, marks: marks.length };
    });
  }

  /**
   * A tick, a part or a comment saved at once (no « send » needed): merged into
   * the client's marks for the version they see. `notify` says whether the chef's
   * bell rings: only after a quiet spell, never once per tick.
   */
  async saveMarks(
    bookingId: string,
    answer: { version: number; marks: MarkInput[] },
    deadline: Date,
  ) {
    return this.locked(bookingId, async (tx, listId) => {
      const list = await tx.shoppingList.findUniqueOrThrow({ where: { id: listId } });
      const now = new Date();
      const refusal = submitRefusal(list, deadline, now, answer.version);
      if (refusal) throw refusal;
      const marks = mergeMarks(sentLinesOf(list), currentMarks(list), answer.marks);
      await tx.shoppingList.update({
        where: { id: listId },
        data: {
          clientMarks: json(marks),
          marksVersion: list.version,
          marksUpdatedAt: now,
        },
      });
      return {
        version: list.version,
        marks: marks.length,
        notify: quietSince(list.marksUpdatedAt, now),
      };
    });
  }

  /**
   * The batch cooker answers the client's comments on the version sent. `notify`
   * says whether the client's bell rings (one per quiet spell).
   */
  async reply(bookingId: string, input: ReplyInput[]) {
    return this.locked(bookingId, async (tx, listId) => {
      const list = await tx.shoppingList.findUniqueOrThrow({ where: { id: listId } });
      const now = new Date();
      const before = repliesOf(list);
      const replies = applyReplies(
        sentLinesOf(list),
        currentMarks(list),
        before,
        input,
        now,
      );
      await tx.shoppingList.update({
        where: { id: listId },
        data: { chefReplies: json(replies) },
      });
      const last = before.reduce<Date | null>((latest, reply) => {
        const at = new Date(reply.repliedAt);
        return !latest || at > latest ? at : latest;
      }, null);
      return { replies: replies.length, notify: quietSince(last, now) };
    });
  }

  /**
   * Tells the people on the page that the list changed (WebSocket
   * `shopping_list.changed`): they fetch it again. Best effort, never thrown.
   */
  async announce(bookingId: string, userIds: string[]) {
    if (!this.events || userIds.length === 0) return;
    try {
      const list = await this.prisma.shoppingList.findUnique({
        where: { bookingId },
        select: { version: true, marksUpdatedAt: true },
      });
      await this.events.publish({
        userIds,
        toUsers: {
          event: 'shopping_list.changed',
          data: {
            bookingId,
            version: list?.version ?? 0,
            marksUpdatedAt: list?.marksUpdatedAt ?? null,
          },
        },
        toAdmins: null,
      });
    } catch (error) {
      this.logger.warn({
        event: 'shopping_list.announce_failed',
        bookingId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
      const items = await tx.shoppingItem.findMany({
        where: { shoppingListId: listId },
      });
      const computed = items.filter((item) => !item.edited).map(toLine);
      // An older front sends no `providedByChef`: the line keeps what it has.
      const live = new Map(linesOf(items).map((line) => [lineKey(line), line]));
      const resolved = wanted.map((line) => ({
        ...line,
        providedByChef: line.providedByChef ?? !!live.get(lineKey(line))?.providedByChef,
      }));
      const corrections = diffCorrections(computed, resolved);
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
          providedByChef: !!c.providedByChef,
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

  /**
   * What the pinned recipes give, scaled to the portions booked and added up. A
   * line the batch cooker always brings (their pantry staples) is marked so.
   */
  private async computedLines(bookingId: string): Promise<Line[]> {
    const pinned = await this.pinRecipes(bookingId);
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { chefProfile: { select: { pantryStaples: true } } },
    });
    const staples = new Set((booking?.chefProfile?.pantryStaples ?? []).map(fold));
    // Recettes §4.12: added up unrounded, rounded once at the end.
    return roundLines(
      aggregate(
        pinned.flatMap((p) => scale(p.recipe.ingredients, p.recipe.portions, p.portions)),
      ),
    ).map((line) =>
      staples.has(fold(line.name)) ? { ...line, providedByChef: true } : line,
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
