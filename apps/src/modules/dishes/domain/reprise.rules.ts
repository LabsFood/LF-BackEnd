/**
 * Pure rules of the reprise of existing dishes (Recettes §9): how a legacy line is
 * linked to the common list, how its unit is converted, and how what the chef
 * declared by hand is kept. No rule here ever drops an allergen.
 */

import { matchKey } from '../../ingredients/domain/ingredient.rules';
import { inAnnexOrder, legacyDeclaredAllergens } from './allergens.rules';
import { toLineInput, type LineInput } from './recipe-lines.rules';

/** An entry of the common list, as the index reads it. */
export interface IndexEntry {
  id: string;
  name: string;
  aliases: string[];
}

/** Every match key of the entries, with the ids of the entries that have it. */
function keysOf(entries: IndexEntry[]): Map<string, string[]> {
  const ids = new Map<string, string[]>();
  for (const entry of entries) {
    for (const text of [entry.name, ...entry.aliases]) {
      const key = matchKey(text);
      if (!key) continue;
      const found = ids.get(key) ?? [];
      if (!found.includes(entry.id)) ids.set(key, [...found, entry.id]);
    }
  }
  return ids;
}

/**
 * Recettes §9: the name, or another name, of each entry under its match key
 * (accents, case, spaces and a simple plural ignored), pointing at the entry. Built
 * from the active common entries only. A key two entries share is left out: the
 * line stays to verify rather than be linked by a guess (`ambiguousKeys`).
 */
export function matchIndex(entries: IndexEntry[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const [key, ids] of keysOf(entries)) {
    if (ids.length === 1) index.set(key, ids[0]);
  }
  return index;
}

/** Recettes §9: the keys `matchIndex` leaves out, for the report. */
export function ambiguousKeys(entries: IndexEntry[]): { key: string; ids: string[] }[] {
  return [...keysOf(entries)]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ key, ids }));
}

/**
 * The words of a legacy line as the chef typed them: quantity, unit, name. The
 * quantity is kept as written, so "1/2" survives even though it is no number.
 */
function originalText(raw: Record<string, unknown>, name: string): string {
  const qty = raw.qty ?? raw.amount;
  const unit = typeof raw.unit === 'string' ? raw.unit.trim() : '';
  return [
    typeof qty === 'number' || typeof qty === 'string' ? String(qty).trim() : '',
    unit,
    name,
  ]
    .filter((part) => part !== '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A reprised line, ready to stamp. `hiddenFromClient` is undefined when the stored
 * line never said: stamping then takes the linked entry's `is_basic` (§5.2), as a
 * save does for a line sent without it (`LineToStamp`).
 */
export type RepriseLine = Omit<LineInput, 'hiddenFromClient'> & {
  hiddenFromClient?: boolean;
};

/**
 * Recettes §9, one line. A line already linked is kept as it is. An unlinked one is
 * linked when its match key names exactly one common entry, never by approximation;
 * otherwise it goes to verification with its original words in `rawText`. The unit
 * is converted either way, and a unit that cannot be converted sends the line to
 * verification (`toLineInput`). Only an explicit `hiddenFromClient` is kept (§5.2):
 * without one, salt or oil end up hidden from the client by their entry.
 */
export function repriseLine(raw: unknown, index: Map<string, string>): RepriseLine {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  // Kept local: `toLineInput` reads an absent value as false for its other callers.
  const line: RepriseLine = {
    ...toLineInput(raw),
    hiddenFromClient:
      typeof value.hiddenFromClient === 'boolean' ? value.hiddenFromClient : undefined,
  };
  if (line.catalogIngredientId) return line;

  const kept =
    typeof value.rawText === 'string' && value.rawText.trim() ? line.rawText : null;
  const id = index.get(matchKey(line.name));
  const linked = id ? { ...line, catalogIngredientId: id } : { ...line, toVerify: true };
  return linked.toVerify
    ? { ...linked, rawText: kept ?? originalText(value, line.name) }
    : linked;
}

/**
 * Recettes §9: the storage a legacy dish keeps. Stored in the freezer, it can be
 * frozen; any other method stays unanswered, for the "Prête" check to ask. An
 * answer the chef already gave is left alone.
 */
function repriseStorage(storage: unknown): unknown {
  if (!storage || typeof storage !== 'object' || Array.isArray(storage)) {
    return storage ?? null;
  }
  const value = storage as Record<string, unknown>;
  return value.method === 'freezer' && typeof value.freezable !== 'boolean'
    ? { ...value, freezable: true }
    : storage;
}

/** What the reprise reads of a dish: its current content, never a version. */
export interface RepriseMeal {
  ingredients: unknown;
  allergens: string[];
  storage: unknown;
  addedAllergens?: string[];
  customAllergens?: string[];
}

/**
 * Recettes §9, one dish: its lines as `repriseLine` leaves them (stored entries that
 * are not lines skipped, as `readLines` skips them), the allergens it must keep as
 * added, its storage, and how many lines wait for the chef.
 *
 * Every allergen declared by hand moves into `addedAllergens`, so none disappears
 * once allergens are computed from the lines. Ruling R7: "declared by hand" is what
 * the stored lines and the chef's own additions do not bring. On a legacy dish that
 * is every listed allergen; on a dish already stamped (saved since, or reprised
 * before) the allergens its lines bring stay computed, so a second pass adds nothing.
 */
export function repriseDish(
  meal: RepriseMeal,
  index: Map<string, string>,
): {
  lines: RepriseLine[];
  addedAllergens: string[];
  storage: unknown;
  linesToVerify: number;
} {
  const raw = Array.isArray(meal.ingredients) ? (meal.ingredients as unknown[]) : [];
  const lines = raw
    .filter(
      (item) =>
        !!item &&
        typeof item === 'object' &&
        String((item as Record<string, unknown>).name ?? '').trim() !== '',
    )
    .map((item) => repriseLine(item, index));
  const added = meal.addedAllergens ?? [];
  const addedAllergens = inAnnexOrder([
    ...added,
    ...legacyDeclaredAllergens({
      allergens: meal.allergens,
      ingredients: meal.ingredients,
      addedAllergens: added,
      customAllergens: meal.customAllergens ?? [],
    }),
  ]);
  return {
    lines,
    addedAllergens,
    storage: repriseStorage(meal.storage),
    linesToVerify: lines.filter((line) => line.toVerify).length,
  };
}

/**
 * The codes of `before` that `after` lacks, annex order. Review Focus point 3: the
 * reprise checks it is empty for every dish before writing.
 */
export function missingAllergens(before: string[], after: string[]): string[] {
  return inAnnexOrder(before.filter((code) => !after.includes(code)));
}
