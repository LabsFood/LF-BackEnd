import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { matchKey, normalizeName } from '../ingredients/domain/ingredient.rules';
import { DishesMailer } from './dishes.mailer';
import { composeLines, compositionColumns, storesComposition } from './dishes.service';
import { inAnnexOrder } from './domain/allergens.rules';
import { readLines } from './domain/recipe-lines.rules';
import { sameContent } from './domain/recipes.rules';
import {
  ambiguousKeys,
  matchIndex,
  missingAllergens,
  repriseDish,
} from './domain/reprise.rules';

/**
 * Recettes §9: the one-off reprise of the existing dishes, run by
 * `prisma/recipes-reprise.ts`. Every meal (chefs' dishes, Lab's Food recipes and
 * offers) has its current content linked to the common list, its units converted,
 * its hand-declared allergens kept as added, and its lines stamped, as a save
 * composes them (shared helpers of `dishes.service.ts`, ruling R7 included).
 *
 * It never loses an allergen, never touches a status, a publication date, a kept
 * version or a booking, and a second run changes nothing: a meal that already stores
 * what the reprise composes is not written, so nobody is told twice. A meal whose
 * lines or storage it changes waits for a new version (`versionPending`, R18), cut
 * at its next "Prête" save or allergen confirmation. A dry run reads the same rows
 * and reports the same figures, but writes and sends nothing.
 */

/** What the reprise reads and writes. A plain Prisma client fits. */
export type RepriseDb = Pick<
  PrismaService,
  'catalogIngredient' | 'meal' | 'notification' | '$transaction'
>;

/** What one meal is read and written through: the client, or its transaction. */
type Tx = Pick<PrismaService, 'catalogIngredient' | 'meal' | 'notification'>;

export type RepriseMailer = Pick<
  DishesMailer,
  'recipesMigrated' | 'recipeAllergensChanged'
>;

export interface RepriseOptions {
  /** Read and report only: no write, no notification, no e-mail. */
  dryRun: boolean;
  /** A line per meal skipped or failed, as it happens. */
  log?: (line: string) => void;
}

/** One chef's figures, or Lab's Food's (`chefProfileId: null`). */
export interface ChefTally {
  chefProfileId: string | null;
  label: string;
  dishesChanged: number;
  /** Lines unlinked before, linked to the common list now. */
  linesLinked: number;
  /** Lines of the changed dishes still waiting for the chef. */
  linesToVerify: number;
  /** Verified dishes a new allergen sent back to verification. */
  verificationsCleared: number;
  /** Recettes §5.5: `recipes_migrated`, by this run or an earlier one. Lab's Food: null. */
  told: 'now' | 'before' | null;
}

export interface RepriseReport {
  dryRun: boolean;
  /** Step 1: `normalized_name` filled, and the names already taken by another entry. */
  names: {
    filled: number;
    conflicts: { id: string; name: string; normalizedName: string }[];
    failed: { id: string; error: string }[];
  };
  /** Match keys two common entries share: lines with them are left to verify. */
  ambiguous: { key: string; ids: string[] }[];
  meals: number;
  changed: number;
  unchanged: number;
  /** Saved by someone else between the read and the write: a rerun picks them up. */
  skipped: string[];
  failed: { id: string; error: string }[];
  chefs: ChefTally[];
  /** The names still unlinked, by frequency, to complete the common list (top 50). */
  unmatched: { name: string; count: number }[];
  /** How many distinct names are unlinked, beyond the top 50 shown. */
  unmatchedNames: number;
  notifications: { recipesMigrated: number; allergensChanged: number };
  /** E-mails meant (both kinds), then how many Brevo took and how many it did not. */
  emails: {
    recipesMigrated: number;
    allergensChanged: number;
    sent: number;
    notSent: number;
  };
}

const LABS_FOOD = "Lab's Food (recipes and offers)";
const UNMATCHED_SHOWN = 50;
/** E-mails sent at once, as the §7.3 propagation sends them. */
const MAIL_BATCH = 10;

/** Who owns a chef's dish: notified in the app, then by e-mail. */
const OWNER = {
  select: {
    id: true,
    userId: true,
    displayName: true,
    user: { select: { email: true, fullName: true } },
  },
} as const;

type Owner = {
  id: string;
  userId: string;
  displayName: string;
  user: { email: string; fullName: string | null };
};

/** One meal, as the reprise left it. */
type Outcome =
  | { kind: 'gone' }
  | { kind: 'unchanged'; unmatched: string[] }
  | {
      kind: 'changed';
      owner: Owner | null;
      linesLinked: number;
      linesToVerify: number;
      unverified: boolean;
      told: 'now' | 'before' | null;
      unmatched: string[];
    };

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const noRowMatched = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';

/**
 * Recettes §9, step 1: `normalized_name` for the entries the API never wrote it on.
 * A name another entry already holds under the same unique index (common entries;
 * a chef's pending ones) is reported, not written: the first entry keeps it.
 */
async function fillNormalizedNames(
  db: RepriseDb,
  dryRun: boolean,
): Promise<RepriseReport['names']> {
  const rows = await db.catalogIngredient.findMany({
    select: {
      id: true,
      name: true,
      normalizedName: true,
      chefProfileId: true,
      status: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  // The scopes of the two partial unique indexes (Recettes §5.1).
  const scope = (row: (typeof rows)[number], normalized: string) =>
    row.chefProfileId === null
      ? `common|${normalized}`
      : row.status === 'pending'
        ? `pending|${row.chefProfileId}|${normalized}`
        : null;
  const taken = new Set(
    rows.flatMap((row) =>
      row.normalizedName ? (scope(row, row.normalizedName) ?? []) : [],
    ),
  );

  const names: RepriseReport['names'] = { filled: 0, conflicts: [], failed: [] };
  for (const row of rows) {
    if (row.normalizedName !== null) continue;
    const normalized = normalizeName(row.name);
    if (!normalized) {
      names.failed.push({ id: row.id, error: 'blank name' });
      continue;
    }
    const key = scope(row, normalized);
    if (key && taken.has(key)) {
      names.conflicts.push({ id: row.id, name: row.name, normalizedName: normalized });
      continue;
    }
    if (key) taken.add(key);
    if (!dryRun) {
      try {
        await db.catalogIngredient.update({
          // Matches nothing once the API has filled it meanwhile: nothing to do then.
          where: { id: row.id, normalizedName: null },
          data: { normalizedName: normalized },
        });
      } catch (error) {
        if (!noRowMatched(error))
          names.failed.push({ id: row.id, error: errorText(error) });
        continue;
      }
    }
    names.filled += 1;
  }
  return names;
}

/**
 * Recettes §9, one meal: its current content reprised and composed, then written in
 * one go with `lockVersion` +1 (and `versionPending` when its recipe content changed),
 * guarded by the `lockVersion` read. A meal that already stores the result is left
 * alone (replay-safe). Notifications are written in the same transaction: they exist
 * exactly when the change they report does.
 */
async function repriseMeal(
  tx: Tx,
  id: string,
  index: Map<string, string>,
  told: Set<string>,
  dryRun: boolean,
): Promise<Outcome> {
  const row = await tx.meal.findUnique({
    where: { id },
    include: { chefProfile: OWNER },
  });
  // Deleted since the list was read: nothing to do.
  if (!row) return { kind: 'gone' };

  const reprised = repriseDish(row, index);
  let composed = await composeLines(
    tx,
    row,
    { addedAllergens: reprised.addedAllergens },
    reprised.lines,
  );
  // Review Focus point 3: no allergen ever disappears. A line stamped before an
  // entry lost an allergen (a §7.3 carry that never reached the dish) would drop it
  // on re-stamping: it is kept as added instead.
  const lost = missingAllergens(row.allergens, composed.state.allergens);
  if (lost.length) {
    composed = await composeLines(
      tx,
      row,
      { addedAllergens: inAnnexOrder([...composed.addedAllergens, ...lost]) },
      reprised.lines,
    );
  }
  const unmatched = composed.ingredients.flatMap((line) =>
    line.catalogIngredientId ? [] : [line.name],
  );

  const storageChanged = !sameContent(row.storage, reprised.storage);
  if (storesComposition(row, composed) && !storageChanged) {
    return { kind: 'unchanged', unmatched };
  }

  // Recettes §9: a verified dish whose computed allergens hold one it did not list.
  const appeared = missingAllergens(composed.state.allergens, row.allergens);
  const unverified = appeared.length > 0 && row.allergensVerifiedAt !== null;
  const owner = row.chefProfile;
  const columns = compositionColumns(composed);
  // R18: the recipe a version keeps changed (its lines as stored, or its storage), so
  // the next "Prête" save or confirmation cuts a version of it; until then bookings
  // pin the last one, legacy units and unlinked lines included. Compared as stored, not as `readLines`
  // reads them: the reprise exists to get the new format into a version. A write of
  // the allergen columns alone leaves the flag as it is.
  const contentChanged =
    storageChanged || !sameContent(row.ingredients, columns.ingredients);
  if (!dryRun) {
    await tx.meal.update({
      // Matches nothing once a save has moved the dish on since the read.
      where: { id, lockVersion: row.lockVersion },
      data: {
        ...columns,
        ...(storageChanged && { storage: reprised.storage as Prisma.InputJsonValue }),
        ...(contentChanged && { versionPending: true }),
        lockVersion: { increment: 1 },
        // Still published, no longer bookable until the chef confirms again. Cleared
        // whatever was read: a confirmation never moves `lockVersion`, so one landing
        // after the read would otherwise stand for allergens never seen.
        ...(appeared.length > 0 && { allergensVerifiedAt: null }),
      },
    });
    if (unverified && owner) {
      await tx.notification.create({
        data: {
          userId: owner.userId,
          type: 'recipe_allergens_changed',
          subjectType: 'meal',
          subjectId: id,
        },
      });
    }
  }

  // Recettes §5.5: `recipes_migrated` once per chef, whatever the number of runs.
  let toldNow: 'now' | 'before' | null = null;
  if (owner && !told.has(owner.id)) {
    const earlier = await tx.notification.findFirst({
      where: {
        type: 'recipes_migrated',
        subjectType: 'chef_profile',
        subjectId: owner.id,
      },
      select: { id: true },
    });
    toldNow = earlier ? 'before' : 'now';
    if (!earlier && !dryRun) {
      await tx.notification.create({
        data: {
          userId: owner.userId,
          type: 'recipes_migrated',
          subjectType: 'chef_profile',
          subjectId: owner.id,
        },
      });
    }
  }

  const before = readLines(row.ingredients);
  return {
    kind: 'changed',
    owner,
    linesLinked: composed.ingredients.filter(
      (line, i) => line.catalogIngredientId && !before[i]?.catalogIngredientId,
    ).length,
    linesToVerify: composed.ingredients.filter((line) => line.toVerify).length,
    unverified,
    told: toldNow,
    unmatched,
  };
}

/**
 * Recettes §9: the whole reprise. Steps: names normalized, index of the active
 * common entries, every meal reprised (`repriseMeal`), then one e-mail per chef
 * (`recipesMigrated`, and `recipeAllergensChanged` when a verification was cleared).
 */
export async function runReprise(
  db: RepriseDb,
  mailer: RepriseMailer,
  options: RepriseOptions,
): Promise<RepriseReport> {
  const { dryRun } = options;
  const log = options.log ?? (() => undefined);

  const names = await fillNormalizedNames(db, dryRun);
  const entries = await db.catalogIngredient.findMany({
    where: { chefProfileId: null, status: 'active' },
    select: { id: true, name: true, aliases: true },
  });
  const index = matchIndex(entries);

  const meals = await db.meal.findMany({
    select: { id: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  const report: RepriseReport = {
    dryRun,
    names,
    ambiguous: ambiguousKeys(entries),
    meals: meals.length,
    changed: 0,
    unchanged: 0,
    skipped: [],
    failed: [],
    chefs: [],
    unmatched: [],
    unmatchedNames: 0,
    notifications: { recipesMigrated: 0, allergensChanged: 0 },
    emails: { recipesMigrated: 0, allergensChanged: 0, sent: 0, notSent: 0 },
  };
  const tallies = new Map<string, ChefTally & { owner: Owner | null }>();
  const told = new Set<string>();
  const unmatched = new Map<string, { name: string; count: number }>();

  for (const { id } of meals) {
    let outcome: Outcome;
    try {
      outcome = dryRun
        ? await repriseMeal(db, id, index, told, true)
        : await db.$transaction((tx) => repriseMeal(tx, id, index, told, false));
    } catch (error) {
      // One meal failing never stops the others; its transaction rolled back.
      if (noRowMatched(error)) {
        report.skipped.push(id);
        log(`  skipped ${id}: saved meanwhile, a rerun picks it up`);
      } else {
        report.failed.push({ id, error: errorText(error) });
        log(`  FAILED ${id}: ${errorText(error)}`);
      }
      continue;
    }
    if (outcome.kind === 'gone') continue;

    for (const name of outcome.unmatched) {
      const key = matchKey(name);
      const seen = unmatched.get(key) ?? { name, count: 0 };
      seen.count += 1;
      unmatched.set(key, seen);
    }
    if (outcome.kind === 'unchanged') {
      report.unchanged += 1;
      continue;
    }

    report.changed += 1;
    const owner = outcome.owner;
    const key = owner?.id ?? '';
    const tally = tallies.get(key) ?? {
      chefProfileId: owner?.id ?? null,
      label: owner?.displayName ?? LABS_FOOD,
      dishesChanged: 0,
      linesLinked: 0,
      linesToVerify: 0,
      verificationsCleared: 0,
      told: null,
      owner,
    };
    tally.dishesChanged += 1;
    tally.linesLinked += outcome.linesLinked;
    tally.linesToVerify += outcome.linesToVerify;
    if (outcome.unverified) {
      tally.verificationsCleared += 1;
      if (owner) report.notifications.allergensChanged += 1;
    }
    if (owner && outcome.told) {
      told.add(owner.id);
      tally.told = outcome.told;
      if (outcome.told === 'now') report.notifications.recipesMigrated += 1;
    }
    tallies.set(key, tally);
  }

  const ordered = [...tallies.values()].sort((a, b) =>
    a.chefProfileId === null
      ? 1
      : b.chefProfileId === null
        ? -1
        : a.label.localeCompare(b.label, 'fr'),
  );
  report.chefs = ordered.map(({ owner: _owner, ...tally }) => tally);
  const ranked = [...unmatched.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name, 'fr'),
  );
  report.unmatched = ranked.slice(0, UNMATCHED_SHOWN);
  report.unmatchedNames = ranked.length;

  await tellChefs(ordered, mailer, report);
  return report;
}

/**
 * Recettes §5.5 / §9: one `recipesMigrated` e-mail per chef told by this run, and one
 * `recipeAllergensChanged` per chef with a dish sent back to verification, MAIL_BATCH
 * at a time. Best effort: the dishes and notifications are written, and an e-mail
 * provider failure never undoes them. A dry run only counts them.
 */
async function tellChefs(
  tallies: (ChefTally & { owner: Owner | null })[],
  mailer: RepriseMailer,
  report: RepriseReport,
): Promise<void> {
  const mails: (() => Promise<{ sent: boolean }>)[] = [];
  for (const tally of tallies) {
    const owner = tally.owner;
    if (!owner) continue;
    const to = { email: owner.user.email, name: owner.user.fullName };
    if (tally.told === 'now') {
      report.emails.recipesMigrated += 1;
      mails.push(() =>
        mailer.recipesMigrated({
          ...to,
          dishCount: tally.dishesChanged,
          linesToVerify: tally.linesToVerify,
        }),
      );
    }
    if (tally.verificationsCleared > 0) {
      report.emails.allergensChanged += 1;
      mails.push(() =>
        mailer.recipeAllergensChanged({ ...to, dishCount: tally.verificationsCleared }),
      );
    }
  }
  if (report.dryRun) return;

  for (let start = 0; start < mails.length; start += MAIL_BATCH) {
    const results = await Promise.all(
      mails.slice(start, start + MAIL_BATCH).map((send) =>
        send().then(
          (result) => result.sent,
          () => false,
        ),
      ),
    );
    for (const sent of results) {
      if (sent) report.emails.sent += 1;
      else report.emails.notSent += 1;
    }
  }
}

/**
 * Recettes §9: the report the script prints. Figures per chef, the names still
 * unlinked by frequency (to complete the common list before the real run), the
 * ambiguous keys and the totals. A dry run says what it "would" do.
 */
export function formatReport(report: RepriseReport): string[] {
  const would = (done: string, planned: string) => (report.dryRun ? planned : done);
  const lines: string[] = [];
  const { names } = report;

  lines.push(
    `Normalized names: ${names.filled} ${would('filled', 'would be filled')}, ` +
      `${names.conflicts.length} already taken, ${names.failed.length} failed`,
  );
  for (const c of names.conflicts) {
    lines.push(
      `  taken: "${c.name}" (${c.id}) -> "${c.normalizedName}" is another entry's`,
    );
  }
  for (const f of names.failed) lines.push(`  failed: ${f.id}: ${f.error}`);

  lines.push(`Ambiguous keys, lines left to verify: ${report.ambiguous.length}`);
  for (const a of report.ambiguous) lines.push(`  "${a.key}": ${a.ids.join(', ')}`);

  lines.push('');
  lines.push(
    `Meals: ${report.meals} read, ${report.changed} ${would('changed', 'would change')}, ` +
      `${report.unchanged} already up to date, ${report.skipped.length} skipped ` +
      `(saved meanwhile), ${report.failed.length} failed`,
  );

  lines.push('');
  lines.push('Per chef:');
  if (report.chefs.length === 0) lines.push('  (none)');
  for (const c of report.chefs) {
    const who = c.chefProfileId ? `${c.label} (${c.chefProfileId})` : c.label;
    const telling =
      c.told === 'now'
        ? would(', told', ', would be told')
        : c.told === 'before'
          ? ', told by an earlier run'
          : '';
    lines.push(
      `  ${who}: ${c.dishesChanged} dishes, ${c.linesLinked} lines linked, ` +
        `${c.linesToVerify} lines to verify, ${c.verificationsCleared} verifications ` +
        `${would('cleared', 'to clear')}${telling}`,
    );
  }
  const total = (pick: (c: ChefTally) => number) =>
    report.chefs.reduce((sum, c) => sum + pick(c), 0);
  lines.push(
    `Totals: ${total((c) => c.dishesChanged)} dishes, ` +
      `${total((c) => c.linesLinked)} lines linked, ` +
      `${total((c) => c.linesToVerify)} lines to verify, ` +
      `${total((c) => c.verificationsCleared)} verifications ${would('cleared', 'to clear')}`,
  );

  lines.push('');
  lines.push(
    `Unlinked names by frequency (${report.unmatched.length} of ${report.unmatchedNames}):`,
  );
  if (report.unmatched.length === 0) lines.push('  (none)');
  for (const u of report.unmatched)
    lines.push(`  ${String(u.count).padStart(5)}  ${u.name}`);

  lines.push('');
  const { notifications: n, emails: e } = report;
  lines.push(
    `Notifications ${would('created', 'that would be created')}: ` +
      `${n.recipesMigrated} recipes_migrated, ${n.allergensChanged} recipe_allergens_changed`,
  );
  lines.push(
    `E-mails${would('', ' that would be sent')}: ${e.recipesMigrated} recipes migrated, ` +
      `${e.allergensChanged} allergens changed` +
      would(` (${e.sent} sent, ${e.notSent} not sent: see the warnings above)`, ''),
  );

  if (report.skipped.length) {
    lines.push('');
    lines.push('Skipped, saved meanwhile (run again to pick them up):');
    for (const id of report.skipped) lines.push(`  ${id}`);
  }
  if (report.failed.length) {
    lines.push('');
    lines.push('Failed (left as they were; run again once fixed):');
    for (const f of report.failed) lines.push(`  ${f.id}: ${f.error}`);
  }
  return lines;
}
