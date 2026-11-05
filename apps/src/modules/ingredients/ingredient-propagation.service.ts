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
   * Ruling R12: dishes a chef saved twice while this ran. Their own save composed
   * them from the entry as it now stands, so nothing is left stale.
   */
  skipped: number;
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

/** Who owns a chef's dish: notified in the app, then by e-mail. */
const OWNER = {
  select: { userId: true, user: { select: { email: true, fullName: true } } },
} as const;

type Owner = { userId: string; user: { email: string; fullName: string | null } };

/** One dish carried: rewritten or not, and whether its verification was cleared. */
type Carried = { written: boolean; unverified: boolean; owner: Owner | null };

const UNCHANGED: Carried = { written: false, unverified: false, owner: null };

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
    actorUserId: string,
    remap?: Remap,
  ): Promise<PropagationResult> {
    // A merge also reaches the lines still linking the entry it replaces.
    const ids = [...new Set([...entryIds, ...(remap ? [remap.from] : [])])];
    const meals = ids.length
      ? await this.prisma.meal.findMany({
          where: dishesLinking(ids),
          select: { id: true },
        })
      : [];

    const result: PropagationResult = { dishes: 0, reverified: 0, chefs: 0, skipped: 0 };
    const told = new Map<string, Told>();
    for (const { id } of meals) {
      const carried = await this.carry(id, remap);
      if (!carried) {
        result.skipped += 1;
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
      actorType: 'admin',
      actorUserId,
      action: 'catalog_ingredient.propagated',
      subjectType: 'catalog_ingredient',
      subjectId: entryIds[0] ?? remap?.from ?? null,
      metadata: { entryIds: ids, ...(remap && { remap }), ...result },
    });
    this.logger.log({ event: 'catalog_ingredient.propagated', entryIds: ids, ...result });
    return result;
  }

  /**
   * Ruling R12: a chef's save between the read and the write moves `lockVersion` on
   * and the write matches nothing (P2025). The dish is read again and tried once
   * more; a second conflict skips it (null). Any other error stops the run.
   */
  private async carry(id: string, remap?: Remap): Promise<Carried | null> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.prisma.$transaction((tx) => this.carryInto(tx, id, remap));
      } catch (error) {
        if (!savedMeanwhile(error)) throw error;
      }
    }
    this.logger.warn({ event: 'catalog_ingredient.propagation_skipped', dishId: id });
    return null;
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
    const lines = remap
      ? before.map((line) =>
          line.catalogIngredientId === remap.from
            ? { ...line, catalogIngredientId: remap.to }
            : line,
        )
      : before;
    const composed = await composeLines(tx, row, {}, lines);
    // Ruling R10's equality: nothing moved, nothing is written (replay-safe).
    if (storesComposition(row, composed)) return UNCHANGED;

    // Compared as the reprise reads the row (ruling R7): legacy allergens count as added.
    const unverified =
      row.allergensVerifiedAt !== null &&
      !sameAllergens(storedState(withLegacyAdded(row)), composed.state);
    await tx.meal.update({
      // Matches nothing once a chef's save has moved the dish on since the read.
      where: { id, lockVersion: row.lockVersion },
      data: {
        ...compositionColumns(composed),
        lockVersion: { increment: 1 },
        // Step 4: still published, no longer bookable until the chef confirms again.
        ...(unverified && { allergensVerifiedAt: null }),
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
   * dishes to verify again. Best effort: the dishes and notifications are written,
   * and an e-mail provider failure never undoes them.
   */
  private async tellChefs(told: Map<string, Told>): Promise<void> {
    await Promise.all(
      [...told].map(async ([userId, chef]) => {
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

const savedMeanwhile = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';

/**
 * Recettes §7.3 step 4: whether the dish's allergens changed. Who brings each one
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
