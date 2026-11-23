/**
 * Import de recettes (DAT §4) : d'une recette lue par l'IA à un brouillon de plat,
 * au format de `POST /me/dishes`. Rien n'est inventé en silence : une valeur estimée
 * est marquée, une ligne douteuse part « à vérifier » avec son texte d'origine, et
 * les allergènes restent à confirmer par le cuisinier (INCO 1169/2011).
 */

import { matchKey, normalizeName } from '../../ingredients/domain/ingredient.rules';
import { matchIndex, type IndexEntry } from '../../dishes/domain/reprise.rules';
import { RECIPE_LIMITS } from '../../dishes/domain/recipes.rules';
import type { ExtractedRecipe } from '../extraction/schema';

/** Seuil de renfort : part des lignes lues avec certitude qui se relient. */
export const CERTAIN_LINK_THRESHOLD = 0.7;

export interface DraftLine {
  name: string;
  qty: number | null;
  unit: string | null;
  catalogIngredientId: string | null;
  toVerify: boolean;
  rawText: string | null;
  optional: boolean;
  preparation: string | null;
  group: string | null;
}

export interface DishDraft {
  name: string;
  description: string | null;
  country: string | null;
  category: string | null;
  portions: number;
  prepMinutes: number;
  cookMinutes: number | null;
  difficulty: 'easy' | 'medium' | 'hard' | null;
  equipment: string[];
  recipe: {
    ingredients: DraftLine[];
    steps: { text: string; type: string | null; durationMinutes: number | null }[];
    storage?: { method: string; days: number; freezable?: boolean };
    reheating?: { note: string };
  };
}

export interface DraftResult {
  dish: DishDraft;
  /** Champs remplis par estimation, pour le surlignage du formulaire. */
  estimatedFields: string[];
  warnings: string[];
  linked: number;
  toVerify: number;
  /** Noms jamais reliés, pour enrichir la liste commune. */
  unlinkedNames: string[];
}

const clip = (text: string | null | undefined, max: number) =>
  text ? text.trim().slice(0, max) || null : null;

const intIn = (value: number | null, min: number, max: number) =>
  value === null || !Number.isFinite(value)
    ? null
    : Math.min(max, Math.max(min, Math.round(value)));

/** L'index de liaison : la liste commune active et les ingrédients du cuisinier. */
export const linkIndex = (entries: IndexEntry[]) => matchIndex(entries);

/** Part des lignes certaines qui se relient (1 sans ligne certaine : rien à renforcer). */
export function certainLinkRate(
  recipe: ExtractedRecipe,
  index: Map<string, string>,
): number {
  const certain = recipe.ingredients.filter((l) => l.certain);
  if (certain.length === 0) return recipe.ingredients.length === 0 ? 0 : 1;
  return certain.filter((l) => index.has(matchKey(l.name))).length / certain.length;
}

function line(
  raw: ExtractedRecipe['ingredients'][number],
  index: Map<string, string>,
): DraftLine {
  const name = clip(raw.name, 120) ?? clip(raw.rawText, 120) ?? 'Ingrédient';
  const id = index.get(matchKey(name)) ?? null;
  let unit = raw.unit;
  let qty =
    raw.qty === null || !Number.isFinite(raw.qty)
      ? null
      : Math.round(raw.qty * 1000) / 1000;
  if (unit === 'to_taste') qty = null;
  if (qty !== null && (qty <= 0 || qty > 100_000)) qty = null;
  if (qty !== null && unit === null) unit = 'piece';
  const incomplete = unit === null || (qty === null && unit !== 'to_taste');
  const toVerify = !id || !raw.certain || incomplete;
  return {
    name,
    qty,
    unit,
    catalogIngredientId: id,
    toVerify,
    rawText: toVerify ? (clip(raw.rawText, 200) ?? name) : null,
    optional: raw.optional,
    preparation: clip(raw.preparation, 120),
    group: clip(raw.group, 60),
  };
}

/** Deux lignes du même groupe reliées au même ingrédient : la seconde reste à vérifier. */
function dedupe(lines: DraftLine[]): DraftLine[] {
  const seen = new Set<string>();
  return lines.map((l) => {
    if (!l.catalogIngredientId) return l;
    const key = `${l.group ?? ''}\u0000${l.catalogIngredientId}`;
    if (!seen.has(key)) {
      seen.add(key);
      return l;
    }
    return {
      ...l,
      catalogIngredientId: null,
      toVerify: true,
      rawText: l.rawText ?? l.name,
    };
  });
}

export function toDishDraft(
  recipe: ExtractedRecipe,
  index: Map<string, string>,
): DraftResult {
  const estimated = new Set(recipe.estimatedFields);
  const warnings = [...recipe.warnings];

  const lines = dedupe(
    recipe.ingredients.slice(0, RECIPE_LIMITS.ingredients).map((l) => line(l, index)),
  );
  if (recipe.ingredients.length > RECIPE_LIMITS.ingredients) {
    warnings.push(
      `Plus de ${RECIPE_LIMITS.ingredients} ingrédients : la liste a été coupée.`,
    );
  }
  const steps = recipe.steps
    .slice(0, RECIPE_LIMITS.steps)
    .map((s) => ({
      text: s.text.trim().slice(0, RECIPE_LIMITS.stepLength),
      type: s.type,
      durationMinutes: intIn(s.durationMinutes, 0, 1440),
    }))
    .filter((s) => s.text);
  if (recipe.steps.length > RECIPE_LIMITS.steps) {
    warnings.push(`Plus de ${RECIPE_LIMITS.steps} étapes : la liste a été coupée.`);
  }

  let portions = intIn(recipe.portions, 1, 100);
  if (portions === null) {
    portions = 4;
    estimated.add('portions');
  }
  if (recipe.portionsNote) warnings.push(`Portions : ${recipe.portionsNote}`);

  let prepMinutes = intIn(recipe.prepMinutes, 0, 1440);
  if (prepMinutes === null) {
    const prepSteps = steps.filter(
      (s) => s.type !== 'cuisson' && s.durationMinutes !== null,
    );
    prepMinutes = prepSteps.length
      ? Math.min(
          1440,
          prepSteps.reduce((n, s) => n + (s.durationMinutes ?? 0), 0),
        )
      : 30;
    estimated.add('prepMinutes');
  }

  const storageDays = intIn(recipe.storageDays, 0, 365);
  const reheating = clip(recipe.reheatingNote, 300);
  const dish: DishDraft = {
    name: clip(recipe.name, 255) ?? 'Recette importée',
    description: clip(recipe.description, 2000),
    country: recipe.country,
    category: recipe.category,
    portions,
    prepMinutes,
    cookMinutes: intIn(recipe.cookMinutes, 0, 1440),
    difficulty: recipe.difficulty,
    equipment: [
      ...new Set(recipe.equipment.map((e) => e.trim().slice(0, 60)).filter(Boolean)),
    ].slice(0, 20),
    recipe: {
      ingredients: lines,
      steps,
      ...(storageDays !== null
        ? {
            storage: {
              method: 'fridge',
              days: storageDays,
              ...(recipe.freezable !== null ? { freezable: recipe.freezable } : {}),
            },
          }
        : {}),
      ...(reheating ? { reheating: { note: reheating } } : {}),
    },
  };

  return {
    dish,
    estimatedFields: [...estimated].sort(),
    warnings,
    linked: lines.filter((l) => l.catalogIngredientId).length,
    toVerify: lines.filter((l) => l.toVerify).length,
    unlinkedNames: [
      ...new Set(
        lines.filter((l) => !l.catalogIngredientId).map((l) => l.name.toLowerCase()),
      ),
    ],
  };
}

/** Un plat du cuisinier au même nom (accents, casse et espaces ignorés). */
export function duplicateOf<T extends { id: string; name: string }>(
  name: string,
  dishes: T[],
): T | null {
  const key = normalizeName(name);
  return dishes.find((d) => normalizeName(d.name) === key) ?? null;
}

/**
 * Allergènes que l'IA soupçonne mais que la liste commune ne calcule pas : un écart
 * à montrer en rouge à côté de « Confirmer les allergènes », jamais ajouté d'office.
 */
export function allergenGaps(suspected: string[], computed: string[]): string[] {
  const have = new Set(computed);
  return [...new Set(suspected)].filter((code) => !have.has(code)).sort();
}
