/**
 * Import de recettes par IA (plan J2) : la note d'une extraction, pour comparer les
 * modèles. Le critère principal est le taux de lignes d'ingrédients reliées à la
 * liste commune par la même règle que la reprise (`matchIndex`, sans approximation).
 */

import { matchKey } from '../../ingredients/domain/ingredient.rules';
import { parseIngredientCsv } from '../../ingredients/domain/ingredient-csv.rules';
import { matchIndex, type IndexEntry } from '../../dishes/domain/reprise.rules';
import { UNIT_CODES } from '../../dishes/domain/units.rules';
import { DEFAULT_RECIPE_AISLES } from '../../platform-settings/recipe-lists';
import { OPTIONAL_TEXT_FIELDS, type Extraction } from './schema';

/** L'index de la liste commune construit depuis le CSV de référence. */
export function catalogIndexFromCsv(csv: string): Map<string, string> {
  const { rows, errors } = parseIngredientCsv(
    csv,
    DEFAULT_RECIPE_AISLES.map((a) => a.code),
  );
  if (errors.length) {
    throw new Error(
      `CSV des ingrédients invalide : ${errors
        .slice(0, 3)
        .map((e) => `ligne ${e.line} ${e.message}`)
        .join(' ; ')}`,
    );
  }
  const entries: IndexEntry[] = rows.map((row) => ({
    id: row.name,
    name: row.name,
    aliases: row.aliases ?? [],
  }));
  return matchIndex(entries);
}

export interface ExtractionScore {
  recipes: number;
  ingredients: number;
  linked: number;
  /** Lignes reliées / lignes, 0 quand il n'y a aucune ligne. */
  linkRate: number;
  certainIngredients: number;
  certainLinked: number;
  invalidUnits: number;
  recipesWithoutSteps: number;
  /** Champs principaux vides, toutes recettes confondues. */
  missingFields: number;
  estimatedFields: number;
  unlinkedNames: string[];
}

const MAIN_FIELDS = ['portions', 'prepMinutes', 'cookMinutes', 'category'] as const;

const ratio = (a: number, b: number) => (b === 0 ? 0 : a / b);

export function scoreExtraction(
  extraction: Extraction,
  index: Map<string, string>,
): ExtractionScore {
  const units = new Set<string>(UNIT_CODES);
  let ingredients = 0;
  let linked = 0;
  let certainIngredients = 0;
  let certainLinked = 0;
  let invalidUnits = 0;
  let recipesWithoutSteps = 0;
  let missingFields = 0;
  let estimatedFields = 0;
  const unlinked = new Set<string>();

  for (const recipe of extraction.recipes) {
    if (recipe.steps.length === 0) recipesWithoutSteps += 1;
    missingFields += MAIN_FIELDS.filter((f) => recipe[f] === null).length;
    estimatedFields += recipe.estimatedFields.length;
    for (const line of recipe.ingredients) {
      ingredients += 1;
      const hit = index.has(matchKey(line.name));
      if (hit) linked += 1;
      else unlinked.add(line.name.trim().toLowerCase());
      if (line.certain) {
        certainIngredients += 1;
        if (hit) certainLinked += 1;
      }
      if (line.unit !== null && !units.has(line.unit)) invalidUnits += 1;
    }
  }

  return {
    recipes: extraction.recipes.length,
    ingredients,
    linked,
    linkRate: ratio(linked, ingredients),
    certainIngredients,
    certainLinked,
    invalidUnits,
    recipesWithoutSteps,
    missingFields,
    estimatedFields,
    unlinkedNames: [...unlinked].sort(),
  };
}

/** Lit une réponse brute : JSON, éventuellement entouré d'un bloc ```json. */
export function parseExtraction(text: string): Extraction {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const value = JSON.parse(trimmed) as unknown;
  if (
    typeof value !== 'object' ||
    value === null ||
    !Array.isArray((value as Extraction).recipes)
  ) {
    throw new Error('Réponse sans tableau « recipes ».');
  }
  const extraction = value as Extraction;
  const blankToNull = (obj: object, fields: readonly string[]) => {
    const rec = obj as Record<string, unknown>;
    for (const f of fields)
      if (typeof rec[f] === 'string' && (rec[f] as string).trim() === '') rec[f] = null;
  };
  for (const recipe of extraction.recipes) {
    blankToNull(recipe, OPTIONAL_TEXT_FIELDS.recipe);
    for (const line of recipe.ingredients ?? [])
      blankToNull(line, OPTIONAL_TEXT_FIELDS.ingredient);
  }
  return { recipes: extraction.recipes, warnings: extraction.warnings ?? [] };
}
