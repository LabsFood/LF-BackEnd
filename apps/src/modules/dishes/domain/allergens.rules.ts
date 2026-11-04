/**
 * Recettes §4.9: a dish's allergens are computed from the ingredients of its recipe
 * lines, never declared alone. A client's allergy check relies on this, so an
 * unknown line never counts as "no allergen" (§6.1 to §6.3).
 */

import { ALLERGEN_CODES } from './dishes.rules';
import type { StoredLine } from './recipe-lines.rules';

export interface AllergenState {
  /** Every allergen of the linked lines (optional ones too) plus the chef's, in annex order. */
  allergens: string[];
  /** Allergens only optional lines bring and the chef did not add; still in `allergens`. */
  conditionalAllergens: string[];
  /** True only when every line is known and nothing is computed, added or written. */
  allergensNone: boolean;
  /** Per allergen, the ingredients that bring it, in line order. Chef-added only: no entry. */
  sources: Record<string, string[]>;
  /** Every line is linked to an ingredient whose allergens are filled in; false without lines. */
  complete: boolean;
}

const inAnnexOrder = (codes: Iterable<string>): string[] => {
  const set = new Set(codes);
  return ALLERGEN_CODES.filter((code) => set.has(code));
};

/**
 * Recettes §6.1 to §6.3. An unlinked line brings nothing and makes the state
 * incomplete. A line linked to an `incomplete` ingredient also makes it incomplete
 * but still brings the allergens it carries: an ingredient is incomplete for other
 * reasons too (e.g. a missing aisle), and dropping known allergens would show a
 * dish with fewer allergens than it has.
 */
export function allergenStateOf(
  lines: StoredLine[],
  added: string[],
  custom: string[],
): AllergenState {
  const known = lines.filter((l) => l.catalogIngredientId);
  const sources: Record<string, string[]> = {};
  const fromRequired = new Set<string>();
  const all = new Set<string>();

  for (const line of known) {
    for (const code of line.allergens) {
      all.add(code);
      if (!line.optional) fromRequired.add(code);
      const names = (sources[code] ??= []);
      if (!names.includes(line.name)) names.push(line.name);
    }
  }
  for (const code of added) all.add(code);

  const allergens = inAnnexOrder(all);
  const conditionalAllergens = allergens.filter(
    (code) => !fromRequired.has(code) && !added.includes(code),
  );
  const orderedSources: Record<string, string[]> = {};
  for (const code of inAnnexOrder(Object.keys(sources))) {
    orderedSources[code] = sources[code];
  }
  const complete =
    lines.length > 0 && lines.every((l) => l.catalogIngredientId && !l.incomplete);

  return {
    allergens,
    conditionalAllergens,
    allergensNone: complete && allergens.length === 0 && custom.length === 0,
    sources: orderedSources,
    complete,
  };
}

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** Whether two states say the same thing, so a save can tell nothing changed. */
export function sameAllergenState(a: AllergenState, b: AllergenState): boolean {
  const codes = Object.keys(a.sources);
  return (
    sameList(a.allergens, b.allergens) &&
    sameList(a.conditionalAllergens, b.conditionalAllergens) &&
    a.allergensNone === b.allergensNone &&
    a.complete === b.complete &&
    sameList(codes, Object.keys(b.sources)) &&
    codes.every((code) => sameList(a.sources[code], b.sources[code]))
  );
}
