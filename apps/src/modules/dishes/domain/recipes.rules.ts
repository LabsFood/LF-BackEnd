/**
 * Pure arithmetic behind the fiche recette and the shopping list (FLOW-02 §7):
 * scale, aggregate, apply the chef's corrections, group by aisle. The PRD rules
 * out any inference here: a line the recipes do not produce is one the chef adds.
 */

import type { ReferenceItem } from './dishes.rules';

export interface Line {
  name: string;
  qty: number;
  unit: string;
  aisle: string;
}

/** A line the chef changed, added (`edited`) or struck out (`removed`). */
export interface Correction extends Line {
  removed: boolean;
}

/** Two decimals; EPSILON so 1.005 rounds to 1.01, not 1. */
const round = (qty: number) => Math.round((qty + Number.EPSILON) * 100) / 100;

/** An ingredient's name, or a unit, whatever the case or accents. */
const fold = (name: string) =>
  name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

/** Reads one stored ingredient; anything not shaped like a line is skipped. */
export function toLine(raw: unknown): Line | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const name = String(value.name ?? '').trim();
  const qty = Number(value.qty ?? value.amount);
  if (!name || !Number.isFinite(qty)) return null;
  return {
    name,
    qty,
    unit: String(value.unit ?? '').trim(),
    aisle: String(value.aisle ?? '').trim() || 'autre',
  };
}

/**
 * A recipe written for `from` portions, for `to` portions (Recettes §4.12). Fixed
 * quantities stay as written. Nothing is rounded here: rounding each line before
 * adding them up piles the errors up, so `roundLines` does it at the very end.
 */
export function scale(ingredients: unknown, from: number, to: number): Line[] {
  const factor = to / (from || 1);
  return (Array.isArray(ingredients) ? ingredients : []).flatMap((raw) => {
    const line = toLine(raw);
    if (!line) return [];
    const fixed = (raw as { fixedQuantity?: unknown }).fixedQuantity === true;
    return [{ ...line, qty: fixed ? line.qty : line.qty * factor }];
  });
}

/** Units counted in whole pieces, folded like ingredient names. */
const PIECES = new Set(['', 'piece', 'pieces', 'pc', 'pcs', 'u', 'unite', 'unites']);

/**
 * Recettes §4.12: rounded once, for display and at the end of the shopping list.
 * Two decimals; a count of pieces goes up to the next whole one.
 */
export function roundLines<T extends Line>(lines: T[]): T[] {
  return lines.map((line) => ({
    ...line,
    qty: PIECES.has(fold(line.unit)) ? Math.ceil(line.qty - 1e-9) : round(line.qty),
  }));
}

/** BLK-27: a child eats half a portion. One portion at least. */
export const householdPortions = (adults: number, kids: number) =>
  Math.max(1, adults + kids / 2);

/** Same ingredient, same unit, whatever the case or accents: one line. */
export const lineKey = (line: { name: string; unit: string }) =>
  `${fold(line.name)}|${line.unit.toLowerCase()}`;

/** Every dish's scaled lines, deduplicated by (ingredient, unit). */
export function aggregate(lines: Line[]): Line[] {
  const merged = new Map<string, Line>();
  for (const line of lines) {
    const key = lineKey(line);
    const existing = merged.get(key);
    if (existing) existing.qty += line.qty;
    else merged.set(key, { ...line });
  }
  return [...merged.values()];
}

/**
 * The list the chef sees: the computed lines, overridden or struck out by their
 * corrections, plus the lines they added. Corrections are keyed like the lines,
 * so they survive a recalculation that produces the same line again.
 */
export function applyCorrections(
  computed: Line[],
  corrections: Correction[],
): (Line & { edited: boolean })[] {
  const byKey = new Map(corrections.map((c) => [lineKey(c), c]));
  const result: (Line & { edited: boolean })[] = [];
  for (const line of computed) {
    const correction = byKey.get(lineKey(line));
    if (!correction) result.push({ ...line, edited: false });
    else if (!correction.removed)
      result.push({ ...stripRemoved(correction), edited: true });
    byKey.delete(lineKey(line));
  }
  for (const added of byKey.values()) {
    if (!added.removed) result.push({ ...stripRemoved(added), edited: true });
  }
  return result;
}

const stripRemoved = ({ name, qty, unit, aisle }: Correction): Line => ({
  name,
  qty,
  unit,
  aisle,
});

/**
 * What the chef's PUT means against the computed list: every line that differs
 * from what the recipes give becomes a correction, and every computed line left
 * out becomes a struck-out one. An unchanged line stores nothing.
 */
export function diffCorrections(computed: Line[], wanted: Line[]): Correction[] {
  const computedByKey = new Map(computed.map((line) => [lineKey(line), line]));
  const corrections: Correction[] = [];
  const seen = new Set<string>();
  for (const line of wanted) {
    const key = lineKey(line);
    seen.add(key);
    const original = computedByKey.get(key);
    if (!original || original.qty !== line.qty || original.aisle !== line.aisle) {
      corrections.push({ ...line, removed: false });
    }
  }
  for (const [key, line] of computedByKey) {
    if (!seen.has(key)) corrections.push({ ...line, removed: true });
  }
  return corrections;
}

/** §7's shape: lines grouped by aisle, aisles in first-seen order. */
export function groupByAisle<T extends Line>(lines: T[]) {
  const groups = new Map<string, Omit<T, 'aisle'>[]>();
  for (const { aisle, ...rest } of lines) {
    if (!groups.has(aisle)) groups.set(aisle, []);
    groups.get(aisle)!.push(rest);
  }
  return [...groups].map(([aisle, groupLines]) => ({ aisle, lines: groupLines }));
}

/** Recettes BLK-28: every list a chef fills gets a cap (decided 2026-11-02). */
export const RECIPE_LIMITS = { ingredients: 60, steps: 40, stepLength: 2000 } as const;

/** The first cap a recipe breaks, as `LIMIT_REACHED` reports it; `null` within them. */
export function recipeLimitBreach(
  ingredientCount: number,
  stepTexts: string[],
): { limit: keyof typeof RECIPE_LIMITS; max: number } | null {
  if (ingredientCount > RECIPE_LIMITS.ingredients) {
    return { limit: 'ingredients', max: RECIPE_LIMITS.ingredients };
  }
  if (stepTexts.length > RECIPE_LIMITS.steps) {
    return { limit: 'steps', max: RECIPE_LIMITS.steps };
  }
  if (stepTexts.some((text) => text.length > RECIPE_LIMITS.stepLength)) {
    return { limit: 'stepLength', max: RECIPE_LIMITS.stepLength };
  }
  return null;
}

/** Recettes §4.5: what a step is, for the timeline and the "Prête" check. */
export const STEP_TYPES: readonly ReferenceItem[] = [
  { code: 'preparation', label: 'Préparation' },
  { code: 'cuisson', label: 'Cuisson' },
  { code: 'refroidissement', label: 'Refroidissement' },
  { code: 'mise_en_boite', label: 'Mise en boîte' },
];

export const STEP_TYPE_CODES = STEP_TYPES.map((t) => t.code);

/** One step as stored and shown: numbered by position, `type` null until chosen. */
export type Step = {
  order: number;
  text: string;
  type: string | null;
  durationMinutes: number | null;
};

/**
 * Steps as the wire shows them, numbered by position. Steps written before §4.5
 * are plain text: they come back untyped, which keeps the recipe from being ready
 * until the chef types them.
 */
export function readSteps(raw: unknown): Step[] {
  const steps: Omit<Step, 'order'>[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const value: Record<string, unknown> | null =
      typeof item === 'string'
        ? { text: item }
        : item && typeof item === 'object'
          ? (item as Record<string, unknown>)
          : null;
    const text = typeof value?.text === 'string' ? value.text.trim() : '';
    if (!text) continue;
    const type =
      typeof value?.type === 'string' && STEP_TYPE_CODES.includes(value.type)
        ? value.type
        : null;
    const minutes = value?.durationMinutes;
    steps.push({
      text,
      type,
      durationMinutes:
        typeof minutes === 'number' && Number.isInteger(minutes) && minutes >= 0
          ? minutes
          : null,
    });
  }
  return steps.map((step, i) => ({ order: i + 1, ...step }));
}

/**
 * Recettes §4.9, R17: an ingredient added, removed or renamed, which asks the chef
 * to verify the allergens again. Quantities, units and aisles never change what a
 * dish contains, so they do not count.
 */
export function ingredientsChanged(before: unknown, after: unknown): boolean {
  const names = (raw: unknown) =>
    new Set(
      (Array.isArray(raw) ? raw : [])
        .map((item) => fold(String((item as { name?: unknown } | null)?.name ?? '')))
        .filter(Boolean),
    );
  const a = names(before);
  const b = names(after);
  return a.size !== b.size || [...a].some((name) => !b.has(name));
}

/** Keys sorted at every level: the database gives JSON back in its own key order. */
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
        )
      : value;

/** Two stored JSON values say the same thing, whatever their key order. */
export const sameContent = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(a ?? null)) === JSON.stringify(canonical(b ?? null));
