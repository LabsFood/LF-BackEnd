/**
 * Pure rules of the common ingredient list (Recettes §5.1): how a name is
 * compared, which diets an ingredient's diet implies, when an entry is complete.
 */

import { COMPUTED_DIET_CODES } from '../../dishes/domain/dishes.rules';

/**
 * An ingredient's name as compared and stored for uniqueness: lowercase, no
 * accents, `œ`/`æ` spelled out, spaces collapsed and trimmed.
 */
export const normalizeName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

/** The longest name, and the longest stored key (`normalized_name VARCHAR(120)`). */
export const NAME_MAX = 120;

/**
 * M4: whether the name's key fits its column. `normalizeName` spells `œ` and `æ`
 * out, so a name of 120 characters can need 121 once normalized.
 */
export const keyFits = (name: string): boolean => normalizeName(name).length <= NAME_MAX;

/**
 * What the search compares: the normalized name with the plural ending (`s`, `x`)
 * dropped from each word, so "Tomates" finds "tomate". A word of three letters or
 * fewer keeps its end ("riz").
 */
export const matchKey = (name: string): string =>
  normalizeName(name)
    .split(' ')
    .map((word) => (word.length > 3 ? word.replace(/[sx]$/, '') : word))
    .join(' ');

/** A diet that entails others (Recettes §5.1): the guard-rail the list is written with. */
const IMPLIED_DIETS: Record<string, string[]> = {
  vegan: ['vegetarian'],
  vegetarian: ['no-pork', 'pescetarian'],
};

/** The diets with everything they imply, once each, in the order of the computed diets. */
export function withImpliedDiets(diets: string[]): string[] {
  const all = new Set<string>();
  const add = (code: string) => {
    if (all.has(code)) return;
    all.add(code);
    (IMPLIED_DIETS[code] ?? []).forEach(add);
  };
  diets.forEach(add);
  const known = COMPUTED_DIET_CODES.filter((code) => all.has(code));
  const others = [...all].filter((code) => !COMPUTED_DIET_CODES.includes(code));
  return [...known, ...others];
}

/**
 * Recettes §5.1: an entry is complete once it has an aisle and its allergens are
 * known, either listed or declared "none". An incomplete one marks the lines using it.
 */
export const isEntryComplete = (entry: {
  aisle: string | null;
  allergens: string[];
  allergensNone: boolean;
}): boolean => !!entry.aisle && (entry.allergens.length > 0 || entry.allergensNone);
