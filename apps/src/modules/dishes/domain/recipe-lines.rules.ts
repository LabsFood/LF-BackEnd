/**
 * Pure rules of a recipe line (Recettes §5.2): reading stored lines, checking the
 * ones a chef sends, finding duplicates (R10) and telling when a change asks the
 * chef to verify the allergens again (§6.5, R17).
 */

import { normalizeName } from '../../ingredients/domain/ingredient.rules';
import { UNIT_CODES, unitFromText } from './units.rules';

/** A line as the chef sends it. */
export interface LineInput {
  name: string;
  /** > 0; null with `to_taste`, or on a "to verify" line. */
  qty: number | null;
  /** One of the unit codes; null only on a "to verify" line. */
  unit: string | null;
  aisle: string | null;
  link: string | null;
  toVerify: boolean;
  fixedQuantity: boolean;
  catalogIngredientId: string | null;
  optional: boolean;
  /** Purchase precision, e.g. "bio". */
  precision: string | null;
  preparation: string | null;
  group: string | null;
  hiddenFromClient: boolean;
  /** The original text of a "to verify" line. */
  rawText: string | null;
}

/** A line as stored: the server writes `allergens` and `incomplete`. */
export interface StoredLine extends LineInput {
  allergens: string[];
  incomplete: boolean;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/**
 * Reads one stored line, legacy or current. A legacy unit is converted by
 * `unitFromText`; one it cannot map sends the line to verification, with the
 * original words kept in `rawText`. So does a quantity typed but no number (R33).
 */
export function toLineInput(raw: unknown): LineInput {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const name = String(value.name ?? '').trim();
  const rawQty = value.qty ?? value.amount;
  let qty =
    rawQty === null || rawQty === undefined || rawQty === '' ? null : Number(rawQty);
  if (qty !== null && !Number.isFinite(qty)) qty = null;

  const unitText = typeof value.unit === 'string' ? value.unit.trim() : '';
  let toVerify = value.toVerify === true;
  let unit: string | null = null;
  let rawText = text(value.rawText);

  if (UNIT_CODES.includes(unitText)) {
    unit = unitText;
  } else if (!(toVerify && !unitText)) {
    unit = unitFromText(unitText);
    if (unit === null) {
      toVerify = true;
      rawText = [qty, unitText, name]
        .filter((part) => part !== null && part !== '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
  }
  // Legacy "selon le goût" lines carried a zero.
  if (unit === 'to_taste' && qty === 0) qty = null;
  // R33: a quantity typed but no number ("1/2", "1,5") waits for the chef, with the
  // words as typed, as an unknown unit does. A "to taste" line needs none.
  const unreadable =
    rawQty !== null && rawQty !== undefined && rawQty !== '' && qty === null;
  if (unreadable && unit !== 'to_taste' && !toVerify) {
    toVerify = true;
    rawText =
      rawText ??
      [
        typeof rawQty === 'string' || typeof rawQty === 'number'
          ? String(rawQty).trim()
          : '',
        unitText,
        name,
      ]
        .filter((part) => part !== '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
  }

  return {
    name,
    qty,
    unit,
    aisle: text(value.aisle),
    link: text(value.link),
    toVerify,
    fixedQuantity: value.fixedQuantity === true,
    catalogIngredientId: text(value.catalogIngredientId),
    optional: value.optional === true,
    precision: text(value.precision),
    preparation: text(value.preparation),
    group: text(value.group),
    hiddenFromClient: value.hiddenFromClient === true,
    rawText,
  };
}

/**
 * Stored JSON as lines, every optional field explicit. Entries that are not objects
 * with a name are skipped.
 */
export function readLines(raw: unknown): StoredLine[] {
  const lines: StoredLine[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!item || typeof item !== 'object') continue;
    const input = toLineInput(item);
    if (!input.name) continue;
    const { allergens, incomplete } = item as Record<string, unknown>;
    lines.push({
      ...input,
      allergens: Array.isArray(allergens)
        ? allergens.filter((a): a is string => typeof a === 'string')
        : [],
      incomplete: incomplete === true,
    });
  }
  return lines;
}

/** What is wrong with the lines a chef sends, by field path like `readiness` writes it. */
export function lineInputProblems(
  lines: LineInput[],
): { field: string; message: string }[] {
  const problems: { field: string; message: string }[] = [];
  lines.forEach((line, i) => {
    const at = (field: string) => `recipe.ingredients[${i}].${field}`;
    if (!line.name.trim()) {
      problems.push({ field: at('name'), message: 'The ingredient needs a name' });
    }
    if (line.unit === null) {
      if (!line.toVerify) {
        problems.push({ field: at('unit'), message: 'The unit is required' });
      }
    } else if (!UNIT_CODES.includes(line.unit)) {
      problems.push({ field: at('unit'), message: 'Unknown unit' });
    }
    if (line.qty !== null && !(line.qty > 0)) {
      problems.push({ field: at('qty'), message: 'The quantity must be above zero' });
    } else if (line.qty !== null && line.unit === 'to_taste') {
      problems.push({
        field: at('qty'),
        message: 'A "to taste" line has no quantity',
      });
    } else if (line.qty === null && line.unit !== 'to_taste' && !line.toVerify) {
      problems.push({ field: at('qty'), message: 'The quantity is required' });
    }
  });
  return problems;
}

/**
 * Recettes R10: lines of the same group, linked to the same ingredient, with the
 * same precision (compared normalized) say the same thing twice. Each result is
 * the indexes of one such set; unlinked lines are not compared.
 */
export function duplicateLines(lines: LineInput[]): number[][] {
  const sets = new Map<string, number[]>();
  lines.forEach((line, i) => {
    if (!line.catalogIngredientId) return;
    const key = JSON.stringify([
      normalizeName(line.group ?? ''),
      line.catalogIngredientId,
      normalizeName(line.precision ?? ''),
    ]);
    sets.set(key, [...(sets.get(key) ?? []), i]);
  });
  return [...sets.values()].filter((indexes) => indexes.length > 1);
}

/** What makes a line count for the allergens: its ingredient, and whether it is optional. */
const compositionKey = (line: LineInput) =>
  `${line.catalogIngredientId ? `id:${line.catalogIngredientId}` : `name:${normalizeName(line.name)}`}|${line.optional}`;

/**
 * Recettes §6.5, R17: a line added or removed, an ingredient changed (the name
 * counts for an unlinked line), or a line turned optional or not. Quantities,
 * units, precisions, preparations, groups and aisles never change what a dish
 * contains, and neither does the order.
 */
export function compositionChanged(before: unknown, after: unknown): boolean {
  const keys = (raw: unknown) => readLines(raw).map(compositionKey).sort();
  const a = keys(before);
  const b = keys(after);
  return a.length !== b.length || a.some((key, i) => key !== b[i]);
}

/** What the re-verification looks at, before or after a save. */
export interface SafetySnapshot {
  ingredients: unknown;
  addedAllergens: string[];
  customAllergens: string[];
  allergens: string[];
  conditionalAllergens: string[];
}

const sameSet = (a: string[], b: string[]) => {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((x) => right.has(x));
};

/**
 * Recettes §6.5: the chef must verify the allergens again when the composition
 * changes, when the allergens they added or wrote change, or when the computed
 * ones do.
 */
export function reverifyNeeded(before: SafetySnapshot, after: SafetySnapshot): boolean {
  return (
    compositionChanged(before.ingredients, after.ingredients) ||
    !sameSet(before.addedAllergens, after.addedAllergens) ||
    !sameSet(before.customAllergens, after.customAllergens) ||
    !sameSet(before.allergens, after.allergens) ||
    !sameSet(before.conditionalAllergens, after.conditionalAllergens)
  );
}
