import { PrismaService } from '../../prisma/prisma.service';
import { AllergenState, allergenStateOf } from '../dishes/domain/allergens.rules';
import { Classification, classify } from '../dishes/domain/classification.rules';
import { validationFailed } from '../dishes/domain/content.errors';
import { LineInput, StoredLine } from '../dishes/domain/recipe-lines.rules';
import { isEntryComplete } from './domain/ingredient.rules';

type Db = Pick<PrismaService, 'catalogIngredient'>;

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
 * value is the entry that replaces it when it was merged (one hop, to a common
 * active entry). A merged entry without a live target, or an unknown id, has no
 * key. At most two queries: the ids, then the merge targets.
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
      where: { id: { in: targetIds }, status: 'active', chefProfileId: null },
      select: ENTRY_SELECT,
    })) as EntryRow[];
    for (const row of found) targets.set(row.id, row);
  }

  for (const row of rows) {
    if (row.status !== 'merged') {
      result.set(row.id, row);
    } else {
      const target = row.mergedIntoId ? targets.get(row.mergedIntoId) : undefined;
      // The query filters, the test double may not: check again.
      if (target && target.status === 'active' && target.chefProfileId === null) {
        result.set(row.id, target);
      }
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
 */
export async function compositionOf(
  db: Db,
  lines: LineToStamp[],
  extras: { addedAllergens: string[]; customAllergens: string[] },
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
  const catalog = new Map(
    [...entries.values()].map((e) => [
      e.id,
      { id: e.id, diets: e.diets, seasonMonths: e.seasonMonths },
    ]),
  );
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
    const reason = entry ? refusal(entry, scope) : 'This ingredient does not exist';
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

function refusal(
  entry: EntryRow,
  scope: { chefProfileId: string | null; previousIds: Set<string> },
): string | null {
  if (entry.status === 'merged') return 'This ingredient was merged into another';
  if (entry.chefProfileId !== null) {
    if (entry.chefProfileId !== scope.chefProfileId) {
      return 'This ingredient belongs to another batch cooker';
    }
    if (entry.status === 'active' || entry.status === 'pending') return null;
  } else if (entry.status === 'active') {
    return null;
  }
  return scope.previousIds.has(entry.id)
    ? null
    : 'This ingredient is no longer available';
}
