/**
 * Recettes §4.8: a dish's diets and seasons, computed from the common ingredient
 * list (§4.10), never typed. Stored on the dish when its ingredients are saved,
 * and again when an ingredient of the list changes, so it is never stale.
 */

import type { ReferenceItem } from './dishes.rules';

/** One entry of the common list, as the classification reads it. */
export interface CatalogEntry {
  id: string;
  diets: string[];
  /** Empty: not seasonal. */
  seasonMonths: number[];
}

// A type, not an interface: Prisma stores it as JSON, which wants an index signature.
export type Classification = {
  /** The diets every ingredient suits. */
  diets: string[];
  /** The months all the seasonal ingredients share; every month when none is seasonal. */
  seasonMonths: number[];
};

const ALL_YEAR = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** Diets the chef declares: they cannot be computed from ingredients (§4.8). */
export const DECLARED_DIETS: readonly ReferenceItem[] = [
  { code: 'halal', label: 'Halal' },
  { code: 'kosher', label: 'Casher' },
];

export const DECLARED_DIET_CODES = DECLARED_DIETS.map((d) => d.code);

const linkOf = (line: unknown) => {
  const id = (line as { catalogIngredientId?: unknown } | null)?.catalogIngredientId;
  return typeof id === 'string' && id ? id : null;
};

/** The entries of the common list a recipe points to, once each. */
export const linkedIds = (ingredients: unknown): string[] => [
  ...new Set(
    (Array.isArray(ingredients) ? ingredients : []).flatMap((l) => linkOf(l) ?? []),
  ),
];

/** Lines a chef still has to link before anything can be computed. */
export const unlinkedLines = (ingredients: unknown): number =>
  (Array.isArray(ingredients) ? ingredients : []).filter((l) => !linkOf(l)).length;

/**
 * `null` ("non calculé") while a line is not linked, or links an entry no longer
 * in the list, or there is no line at all: a partial answer would claim a diet
 * an unlinked ingredient may break.
 */
export function classify(
  ingredients: unknown,
  catalog: Map<string, CatalogEntry>,
): Classification | null {
  const lines = Array.isArray(ingredients) ? ingredients : [];
  const entries = lines.map((line) => catalog.get(linkOf(line) ?? ''));
  if (entries.length === 0 || entries.some((e) => !e)) return null;
  const all = entries as CatalogEntry[];

  const diets = [...new Set(all.flatMap((e) => e.diets))]
    .filter((diet) => all.every((e) => e.diets.includes(diet)))
    .sort();
  const seasonal = all.filter((e) => e.seasonMonths.length > 0);
  const seasonMonths = seasonal.length
    ? ALL_YEAR.filter((m) => seasonal.every((e) => e.seasonMonths.includes(m)))
    : ALL_YEAR;
  return { diets, seasonMonths };
}

/** A batch cooker's own version of an entry they adopted (BLK-33). */
export interface ChefVersion {
  catalogIngredientId: string;
  diets: string[];
  seasonMonths: number[];
}

/**
 * The entries a chef's dish is classified from: their version of what they
 * adopted, the common entry for the rest. A version whose entry left the common
 * list is dropped, so the line reads as unlinked ("non calculé").
 */
export function withChefVersions(
  entries: CatalogEntry[],
  own: ChefVersion[],
): Map<string, CatalogEntry> {
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const v of own) {
    if (!byId.has(v.catalogIngredientId)) continue;
    byId.set(v.catalogIngredientId, {
      id: v.catalogIngredientId,
      diets: v.diets,
      seasonMonths: v.seasonMonths,
    });
  }
  return byId;
}
