/**
 * Pure arithmetic behind the fiche recette and the shopping list (FLOW-02 §7):
 * scale, aggregate, apply the chef's corrections, group by aisle. The PRD rules
 * out any inference here: a line the recipes do not produce is one the chef adds.
 */

import type { ReferenceItem } from './dishes.rules';
import { roundForDisplay, unitFromText } from './units.rules';

export interface Line {
  name: string;
  qty: number;
  unit: string;
  aisle: string;
  /**
   * Set (true) only on a line every recipe marks optional (decision of 16/11): it
   * stays on the shopping list with an « facultatif » badge. A line hidden from the
   * client (`hiddenFromClient`) is an ordinary line here: the client pays for it.
   */
  optional?: true;
}

/** A line the chef changed, added (`edited`) or struck out (`removed`). */
export interface Correction extends Line {
  removed: boolean;
}

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
  const unit = String(value.unit ?? '').trim();
  const rawQty = value.qty ?? value.amount;
  // Recettes §4.12: "selon le goût" has no number, so it reads as zero.
  const qty = rawQty == null && unit === 'to_taste' ? 0 : Number(rawQty);
  if (!name || !Number.isFinite(qty)) return null;
  return {
    name,
    qty,
    unit,
    aisle: String(value.aisle ?? '').trim() || 'autre',
    ...(value.optional === true ? { optional: true as const } : {}),
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

/**
 * Recettes §4.12: rounded once, for display and at the end of the shopping list,
 * by the rule of its unit. A legacy free-text unit is read as its unit code first.
 */
export function roundLines<T extends Line>(lines: T[]): T[] {
  return lines.map((line) => ({
    ...line,
    qty: roundForDisplay(line.qty, unitFromText(line.unit) ?? line.unit),
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
    if (existing) {
      existing.qty += line.qty;
      // Optional only if every dish that asks for it says so.
      if (!line.optional) delete existing.optional;
    } else merged.set(key, { ...line });
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
      result.push({
        ...stripRemoved(correction),
        ...(line.optional ? { optional: line.optional } : {}),
        edited: true,
      });
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

/**
 * §7's shape: lines grouped by aisle. Recettes §5.4: aisles come in store order
 * (`order`, the codes of the aisle list in force); any other aisle (legacy free
 * text, `autre`) follows, in first-seen order.
 */
export function groupByAisle<T extends Line>(lines: T[], order: string[]) {
  const groups = new Map<string, Omit<T, 'aisle'>[]>();
  for (const { aisle, ...rest } of lines) {
    if (!groups.has(aisle)) groups.set(aisle, []);
    groups.get(aisle)!.push(rest);
  }
  const rank = (aisle: string) => {
    const at = order.indexOf(aisle);
    return at === -1 ? order.length : at;
  };
  // Array.prototype.sort is stable: unknown aisles keep their first-seen order.
  return [...groups]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([aisle, groupLines]) => ({ aisle, lines: groupLines }));
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
