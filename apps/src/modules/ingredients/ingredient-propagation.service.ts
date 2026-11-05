import { Injectable, Logger } from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DishesMailer } from '../dishes/dishes.mailer';
import {
  composeLines,
  compositionColumns,
  storedState,
  storesComposition,
  withLegacyAdded,
} from '../dishes/dishes.service';
import { AllergenState, sameAllergenState } from '../dishes/domain/allergens.rules';
import { readLines, StoredLine } from '../dishes/domain/recipe-lines.rules';
import { NotificationsService } from '../notifications/notifications.service';

/** What one propagation did, as the audit log keeps it (Recettes §7.3). */
export interface PropagationResult {
  /** Dishes rewritten from the list as it now stands. */
  dishes: number;
  /** Verified dishes whose allergens changed: their verification is cleared. */
  reverified: number;
  /** Chefs told about those dishes, one e-mail each. */
  chefs: number;
  /**
   * Rulings R12/R12b: dishes saved twice by someone else while this ran, and found
   * fresh when read and composed once more: a save in between composed them from
   * the entry as it now stands.
   */
  skipped: number;
  /**
   * Ruling R14: dishes left as they were, so a replay
   * (`POST /admin/ingredients/:id/propagate`) finds them still to carry: their write
   * failed (an error other than a conflict), or two saves in between left them
   * stale (R12b: a name or description autosave moves `lockVersion` on without
   * recomposing).
   */
  failed: number;
}

/**
 * Who changed the entry, as the audit log records them: Lab's Food, or the chef
 * whose private entry it is (Recettes §7.1).
 */
export interface PropagationActor {
  type: 'admin' | 'chef';
  userId: string;
}

/** A merge (Recettes §7.2): the lines linking `from` link `to` instead. */
export interface Remap {
  from: string;
  to: string;
}

/**
 * Recettes §7.3: the dishes with a line linking one of these entries, the query the
 * classification refresh of the list used. Shared with the impact count (§7.2).
 */
export const dishesLinking = (ids: string[]): Prisma.MealWhereInput => ({
  OR: ids.map((id) => ({
    ingredients: { array_contains: [{ catalogIngredientId: id }] },
  })),
});

/**
 * Recettes §7.3: the entries merged into these. A line merged before it was ever
 * repointed still links the old id, and composes from the entry it was merged into
 * (`entriesFor` follows the hop), so a change to that entry reaches it too.
 */
export async function mergedInto(
  db: Pick<PrismaService, 'catalogIngredient'>,
  ids: string[],
): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await db.catalogIngredient.findMany({
    where: { mergedIntoId: { in: ids }, status: 'merged' },
    select: { id: true },
  });
  return rows.map((row) => row.id).filter((id) => !ids.includes(id));
}

/** Who owns a chef's dish: notified in the app, then by e-mail. */
const OWNER = {
  select: { userId: true, user: { select: { email: true, fullName: true } } },
} as const;

type Owner = { userId: string; user: { email: string; fullName: string | null } };

/**
 * One dish carried: rewritten or not, and whether a verification it had was cleared.
 * `skipped` and `failed` are ruling R12b's outcomes after two conflicts.
 */
type Carried =
  { written: boolean; unverified: boolean; owner: Owner | null } | 'skipped' | 'failed';

const UNCHANGED: Carried = { written: false, unverified: false, owner: null };

/** E-mails sent at once: a large propagation never floods the provider. */
const MAIL_BATCH = 10;

/** A chef told once per propagation, however many of their dishes changed. */
type Told = { email: string; name: string | null; dishCount: number };

/**
 * Recettes §7.3: carries a change of the common list into every recipe linking it,
 * chefs' dishes and Lab's Food recipes alike. Each dish is recomposed exactly as a
 * save composes it (shared helpers of `dishes.service.ts`, ruling R7 included) and
 * written in its own transaction, guarded by the `lockVersion` read (ruling R12).
 * Replaying it changes nothing more: a dish already stamped from the list as it
 * stands is not written again, so nobody is told twice.
 */
@Injectable()
export class IngredientPropagationService {
  private readonly logger = new Logger(IngredientPropagationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly mailer: DishesMailer,
    private readonly audit: AuditService,
  ) {}

  async propagate(
    entryIds: string[],
    actor: PropagationActor,
    remap?: Remap,
  ): Promise<PropagationResult> {
    const given = [...new Set(entryIds)];
    // A merge also reaches the lines still linking the entry it replaces, and so
    // does a change to an entry other entries were merged into before.
    const ids = [...new Set([...given, ...(remap ? [remap.from] : [])])];
    const merged = await mergedInto(this.prisma, ids);
    const searched = [...ids, ...merged];
    const meals = searched.length
      ? await this.prisma.meal.findMany({
          where: dishesLinking(searched),
          select: { id: true },
        })
      : [];

    const result: PropagationResult = {
      dishes: 0,
      reverified: 0,
      chefs: 0,
      skipped: 0,
      failed: 0,
    };
    const told = new Map<string, Told>();
    for (const { id } of meals) {
      let carried: Carried;
      try {
        carried = await this.carry(id, remap);
      } catch (error) {
        // Ruling R14: one dish failing never leaves the others with stale allergens.
        // Its transaction rolled back (no write, no notification): a replay carries it.
        result.failed += 1;
        this.logger.error({
          event: 'catalog_ingredient.propagation_failed',
          dishId: id,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      if (carried === 'skipped' || carried === 'failed') {
        result[carried] += 1;
        continue;
      }
      if (!carried.written) continue;
      result.dishes += 1;
      if (!carried.unverified) continue;
      result.reverified += 1;
      // Lab's Food recipes (no owner) are recomputed and cleared, but nobody is told.
      const owner = carried.owner;
      if (owner) {
        const chef = told.get(owner.userId) ?? {
          email: owner.user.email,
          name: owner.user.fullName,
          dishCount: 0,
        };
        chef.dishCount += 1;
        told.set(owner.userId, chef);
      }
    }
    result.chefs = told.size;

    await this.tellChefs(told);
    await this.audit.record({
      actorType: actor.type,
      actorUserId: actor.userId,
      action: 'catalog_ingredient.propagated',
      subjectType: 'catalog_ingredient',
      subjectId: entryIds[0] ?? remap?.from ?? null,
      // The ids as given; a merge and the entries merged into them, apart.
      metadata: {
        entryIds: given,
        ...(remap && { remap }),
        ...(merged.length > 0 && { mergedIds: merged }),
        ...result,
      },
    });
    this.logger.log({
      event: 'catalog_ingredient.propagated',
      entryIds: given,
      ...result,
    });
    return result;
  }

  /**
   * Ruling R12: a save between the read and the write moves `lockVersion` on and
   * the write matches nothing (P2025). The dish is read again and tried once more.
   * Ruling R12b: after a second conflict it is read and composed once more. Fresh
   * (a save in between recomposed it), it is `skipped`; still stale (saves that sent
   * no recipe), it is `failed`, for a replay. Any other error is thrown, for the run
   * to count this dish as failed and go on (ruling R14).
   */
  private async carry(id: string, remap?: Remap): Promise<Carried> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.prisma.$transaction((tx) => this.carryInto(tx, id, remap));
      } catch (error) {
        if (!savedMeanwhile(error)) throw error;
      }
    }
    const fresh = await this.isFresh(id, remap);
    this.logger.warn({
      event: fresh
        ? 'catalog_ingredient.propagation_skipped'
        : 'catalog_ingredient.propagation_stale',
      dishId: id,
    });
    return fresh ? 'skipped' : 'failed';
  }

  /** Ruling R12b: the dish stores what a composition from the list now gives. */
  private async isFresh(id: string, remap?: Remap): Promise<boolean> {
    const row = await this.prisma.meal.findUnique({ where: { id } });
    // Deleted meanwhile: nothing left to carry.
    if (!row) return true;
    const composed = await composeLines(
      this.prisma,
      row,
      {},
      remapped(readLines(row.ingredients), remap),
    );
    return storesComposition(row, composed);
  }

  /**
   * Recettes §7.3, steps 1 to 4, for one dish: repoint (merge), re-stamp and
   * recompose, then one write with `lockVersion` +1. The notification is written in
   * the same transaction: it exists exactly when the change it reports does.
   */
  private async carryInto(
    tx: Prisma.TransactionClient,
    id: string,
    remap?: Remap,
  ): Promise<Carried> {
    const row = await tx.meal.findUnique({
      where: { id },
      include: { chefProfile: OWNER },
    });
    // Deleted since the search: nothing to carry.
    if (!row) return UNCHANGED;

    const before = readLines(row.ingredients);
    const composed = await composeLines(tx, row, {}, remapped(before, remap));
    // Ruling R10's equality: nothing moved, nothing is written (replay-safe).
    if (storesComposition(row, composed)) return UNCHANGED;

    // Compared as the reprise reads the row (ruling R7): legacy allergens count as added.
    const allergensChanged = !sameAllergens(
      storedState(withLegacyAdded(row)),
      composed.state,
    );
    // Told and counted only for a verification the read saw.
    const unverified = allergensChanged && row.allergensVerifiedAt !== null;
    await tx.meal.update({
      // Matches nothing once a save has moved the dish on since the read.
      where: { id, lockVersion: row.lockVersion },
      data: {
        ...compositionColumns(composed),
        lockVersion: { increment: 1 },
        // Step 4: still published, no longer bookable until the chef confirms again.
        // Cleared whatever was read: a confirmation never moves `lockVersion`, so one
        // landing after the read would otherwise stand for allergens never seen.
        ...(allergensChanged && { allergensVerifiedAt: null }),
        // Step 3: the next version takes the content as it now reads.
        ...(renamedOrRepointed(before, composed.ingredients) && { versionPending: true }),
      },
    });
    const owner = row.chefProfile;
    if (unverified && owner) {
      await this.notifications.notify(
        owner.userId,
        'recipe_allergens_changed',
        { type: 'meal', id },
        tx,
      );
    }
    return { written: true, unverified, owner };
  }

  /**
   * Recettes §5.5: one e-mail per chef and per propagation, with the count of their
   * dishes to verify again, `MAIL_BATCH` at a time. Best effort: the dishes and
   * notifications are written, and an e-mail provider failure never undoes them.
   */
  private async tellChefs(told: Map<string, Told>): Promise<void> {
    const chefs = [...told];
    for (let start = 0; start < chefs.length; start += MAIL_BATCH) {
      await Promise.all(
        chefs.slice(start, start + MAIL_BATCH).map(async ([userId, chef]) => {
          try {
            await this.mailer.recipeAllergensChanged(chef);
          } catch (error) {
            this.logger.error({
              event: 'catalog_ingredient.propagation_email_failed',
              userId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }),
      );
    }
  }
}

const savedMeanwhile = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';

/**
 * Recettes §7.3 step 4: whether the dish's allergens changed. Rulings R13/R13b: the
 * allergens and conditional allergens, plus `allergensNone` and `complete` (a safer
 * superset: an entry turning incomplete re-verifies too). Who brings each one
 * (`sources`) is left out: a renamed entry renames its source, the allergens stay,
 * and §6.5 keeps a verification across a rename of a linked line.
 */
const sameAllergens = (a: AllergenState, b: AllergenState) =>
  sameAllergenState({ ...a, sources: {} }, { ...b, sources: {} });

/**
 * Recettes §7.3 step 3: a line's ingredient was renamed, or the line now links
 * another entry (a merge). `after` is `before` re-stamped, line for line.
 */
const renamedOrRepointed = (before: StoredLine[], after: StoredLine[]) =>
  after.some(
    (line, i) =>
      line.catalogIngredientId !== before[i].catalogIngredientId ||
      (line.catalogIngredientId !== null && line.name !== before[i].name),
  );

/** A merge (Recettes §7.2, step 1): the lines linking `from` link `to` instead. */
const remapped = (lines: StoredLine[], remap?: Remap): StoredLine[] =>
  remap
    ? lines.map((line) =>
        line.catalogIngredientId === remap.from
          ? { ...line, catalogIngredientId: remap.to }
          : line,
      )
    : lines;
