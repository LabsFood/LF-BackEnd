import { PrismaService } from '../../prisma/prisma.service';
import { AllergenState, allergenStateOf } from '../dishes/domain/allergens.rules';
import {
  Classification,
  classify,
  withChefVersions,
} from '../dishes/domain/classification.rules';
import { validationFailed } from '../dishes/domain/content.errors';
import { LineInput, StoredLine } from '../dishes/domain/recipe-lines.rules';
import { isEntryComplete } from './domain/ingredient.rules';

type Db = Pick<PrismaService, 'catalogIngredient'>;

/** What a composition reads: the common list, and a chef's adopted versions (BLK-33). */
export type ComposeDb = Pick<PrismaService, 'catalogIngredient' | 'chefIngredient'>;

/** A line as a DTO may send it: `hiddenFromClient` can be left out (the entry decides). */
export type LineToStamp = Omit<LineInput, 'hiddenFromClient'> & {
  hiddenFromClient?: boolean;
};

/** One entry of the common list, with what a recipe line copies from it. */
export interface EntryRow {
  id: string;
  name: string;
  aisle: string | null;
  allergens: string[];
  allergensNone: boolean;
  isBasic: boolean;
  diets: string[];
  seasonMonths: number[];
  status: string;
  chefProfileId: string | null;
  mergedIntoId: string | null;
}

const ENTRY_SELECT = {
  id: true,
  name: true,
  aisle: true,
  allergens: true,
  allergensNone: true,
  isBasic: true,
  diets: true,
  seasonMonths: true,
  status: true,
  chefProfileId: true,
  mergedIntoId: true,
} as const;

/**
 * Recettes §4.10: the entries behind some ids. The key is the id asked for; the
 * value is the entry that replaces it when it was merged (one hop). The hop is
 * followed whatever the target's status: Recettes §7.3, an entry deactivated since
 * stays valid on the lines that have it, so its allergens must never drop. A merged
 * entry whose target row is gone, or an unknown id, has no key. At most two
 * queries: the ids, then the merge targets.
 */
export async function entriesFor(db: Db, ids: string[]): Promise<Map<string, EntryRow>> {
  const wanted = [...new Set(ids)];
  const result = new Map<string, EntryRow>();
  if (!wanted.length) return result;

  const rows = (await db.catalogIngredient.findMany({
    where: { id: { in: wanted } },
    select: ENTRY_SELECT,
  })) as EntryRow[];

  const targetIds = [
    ...new Set(
      rows.flatMap((r) =>
        r.status === 'merged' && r.mergedIntoId ? r.mergedIntoId : [],
      ),
    ),
  ];
  const targets = new Map<string, EntryRow>();
  if (targetIds.length) {
    const found = (await db.catalogIngredient.findMany({
      where: { id: { in: targetIds } },
      select: ENTRY_SELECT,
    })) as EntryRow[];
    for (const row of found) targets.set(row.id, row);
  }

  for (const row of rows) {
    if (row.status !== 'merged') {
      result.set(row.id, row);
    } else {
      const target = row.mergedIntoId ? targets.get(row.mergedIntoId) : undefined;
      if (target) result.set(row.id, target);
    }
  }
  return result;
}

/**
 * Recettes §4.10 / §5.2: copies the linked entry's name, aisle and allergens onto
 * each line, with `incomplete` when the entry is. An id with no entry in the map
 * unlinks the line and sends it to verification, keeping its words in `rawText`.
 * Pure: every later computation reads the stamped lines.
 */
export function stampLines(
  lines: LineToStamp[],
  entries: Map<string, EntryRow>,
): StoredLine[] {
  return lines.map((line): StoredLine => {
    const id = line.catalogIngredientId;
    if (!id) {
      return {
        ...line,
        hiddenFromClient: line.hiddenFromClient ?? false,
        allergens: [],
        incomplete: false,
      };
    }
    const entry = entries.get(id);
    if (!entry) {
      const rawText =
        line.rawText?.trim() ||
        [line.qty, line.unit, line.name]
          .filter((part) => part !== null && part !== '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
      return {
        ...line,
        catalogIngredientId: null,
        toVerify: true,
        rawText,
        hiddenFromClient: line.hiddenFromClient ?? false,
        allergens: [],
        incomplete: false,
      };
    }
    return {
      ...line,
      catalogIngredientId: entry.id,
      name: entry.name,
      aisle: entry.aisle,
      allergens: [...entry.allergens],
      incomplete: !isEntryComplete(entry),
      hiddenFromClient: line.hiddenFromClient ?? entry.isBasic,
    };
  });
}

/**
 * Recettes §4.8 / §6: the stamped lines of a recipe with its allergen state and
 * its classification, the three results a save writes together.
 *
 * BLK-33 (kept with the socle, 13/11): a chef's dish takes the diets and months of
 * the entries that chef adopted, from their own version; everything else, and the
 * allergens always, from the common entry. A Lab's Food recipe
 * (`chefProfileId` null) reads the common list only.
 */
export async function compositionOf(
  db: ComposeDb,
  lines: LineToStamp[],
  extras: { addedAllergens: string[]; customAllergens: string[] },
  chefProfileId: string | null = null,
): Promise<{
  ingredients: StoredLine[];
  state: AllergenState;
  classification: Classification | null;
}> {
  const ids = lines.flatMap((l) => l.catalogIngredientId ?? []);
  const entries = await entriesFor(db, ids);
  const ingredients = stampLines(lines, entries);
  const state = allergenStateOf(
    ingredients,
    extras.addedAllergens,
    extras.customAllergens,
  );
  const common = [...entries.values()].map((e) => ({
    id: e.id,
    diets: e.diets,
    seasonMonths: e.seasonMonths,
  }));
  const own =
    chefProfileId && common.length
      ? await db.chefIngredient.findMany({
          where: { chefProfileId, catalogIngredientId: { in: common.map((e) => e.id) } },
          select: { catalogIngredientId: true, diets: true, seasonMonths: true },
        })
      : [];
  const catalog = withChefVersions(common, own);
  return {
    ingredients,
    state,
    classification: classify(ingredients, catalog, state.allergens),
  };
}

/**
 * Recettes §4.10: a recipe may link an active common entry, or an entry private
 * to its own chef (pending or active). Inactive entries stay for a dish that
 * already had them (`previousIds`); a merged or unknown one never. A recipe of
 * Lab's Food (`chefProfileId: null`) links no private entry. The error names the
 * offending lines.
 */
export async function assertIngredientAccess(
  db: Db,
  lines: LineToStamp[],
  scope: { chefProfileId: string | null; previousIds: Set<string> },
): Promise<void> {
  const ids = [...new Set(lines.flatMap((l) => l.catalogIngredientId ?? []))];
  if (!ids.length) return;
  const rows = (await db.catalogIngredient.findMany({
    where: { id: { in: ids } },
    select: ENTRY_SELECT,
  })) as EntryRow[];
  const byId = new Map(rows.map((r) => [r.id, r]));

  const problems: { field: string; message: string }[] = [];
  lines.forEach((line, i) => {
    const id = line.catalogIngredientId;
    if (!id) return;
    const entry = byId.get(id);
    const reason = entry ? refusal(entry, scope) : NOT_AVAILABLE;
    if (reason) {
      problems.push({ field: `recipe.ingredients[${i}]`, message: reason });
    }
  });
  if (problems.length) {
    throw validationFailed('Some ingredients cannot be used in this recipe.', {
      errors: problems,
    });
  }
}

/**
 * One message for an unknown id and for another chef's private one (Recettes §7.1),
 * so a refusal never confirms that someone else's ingredient exists.
 */
const NOT_AVAILABLE = 'This ingredient is not available to you';

function refusal(
  entry: EntryRow,
  scope: { chefProfileId: string | null; previousIds: Set<string> },
): string | null {
  // Ownership first: another chef's entry, merged or not, never shows its state.
  if (entry.chefProfileId !== null && entry.chefProfileId !== scope.chefProfileId) {
    return NOT_AVAILABLE;
  }
  if (entry.status === 'merged') return 'This ingredient was merged into another';
  if (entry.chefProfileId !== null) {
    if (entry.status === 'active' || entry.status === 'pending') return null;
  } else if (entry.status === 'active') {
    return null;
  }
  return scope.previousIds.has(entry.id)
    ? null
    : 'This ingredient is no longer available';
}
