/**
 * Pure arithmetic behind the fiche recette and the shopping list (FLOW-02 §7):
 * scale, aggregate, apply the chef's corrections, group by aisle. The PRD rules
 * out any inference here: a line the recipes do not produce is one the chef adds.
 */

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

/** A recipe written for `from` portions, for `to` portions. */
export function scale(ingredients: unknown, from: number, to: number): Line[] {
  const factor = to / (from || 1);
  return (Array.isArray(ingredients) ? ingredients : [])
    .map(toLine)
    .filter((line): line is Line => line !== null)
    .map((line) => ({ ...line, qty: round(line.qty * factor) }));
}

/** Same ingredient, same unit, whatever the case or accents: one line. */
export const lineKey = (line: { name: string; unit: string }) =>
  `${line.name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()}|${line.unit.toLowerCase()}`;

/** Every dish's scaled lines, deduplicated by (ingredient, unit). */
export function aggregate(lines: Line[]): Line[] {
  const merged = new Map<string, Line>();
  for (const line of lines) {
    const key = lineKey(line);
    const existing = merged.get(key);
    if (existing) existing.qty = round(existing.qty + line.qty);
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
