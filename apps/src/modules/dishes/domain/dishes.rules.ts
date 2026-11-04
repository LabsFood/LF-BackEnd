/**
 * Pure rules behind FLOW-02. No database, no I/O: everything here is a function of
 * a dish or menu as stored, so the checks in §3.3 and §3.4 can be read against the
 * tests next to this file.
 */

import { readLines } from './recipe-lines.rules';
import { readSteps } from './recipes.rules';

export interface ReferenceItem {
  code: string;
  label: string;
}

/**
 * The 14 allergens food law requires to be declared (EU regulation 1169/2011,
 * annex II), in the order of the annex. A closed list: "gluten" typed as free
 * text next to the official entry would make the declaration unreadable (§3.1).
 */
export const ALLERGENS: readonly ReferenceItem[] = [
  { code: 'gluten', label: 'Céréales contenant du gluten' },
  { code: 'crustaceans', label: 'Crustacés' },
  { code: 'eggs', label: 'Œufs' },
  { code: 'fish', label: 'Poissons' },
  { code: 'peanuts', label: 'Arachides' },
  { code: 'soy', label: 'Soja' },
  { code: 'milk', label: 'Lait' },
  { code: 'nuts', label: 'Fruits à coque' },
  { code: 'celery', label: 'Céleri' },
  { code: 'mustard', label: 'Moutarde' },
  { code: 'sesame', label: 'Graines de sésame' },
  { code: 'sulphites', label: 'Anhydride sulfureux et sulfites' },
  { code: 'lupin', label: 'Lupin' },
  { code: 'molluscs', label: 'Mollusques' },
];

/** Diets a dish can claim. Anything else goes in `customDiets` (§3.1). */
export const DIETS: readonly ReferenceItem[] = [
  { code: 'vegetarian', label: 'Végétarien' },
  { code: 'vegan', label: 'Végan' },
  { code: 'halal', label: 'Halal' },
  { code: 'gluten-free', label: 'Sans gluten' },
  { code: 'lactose-free', label: 'Sans lactose' },
  { code: 'nut-free', label: 'Sans fruits à coque' },
];

/**
 * Recettes §4.8: the diets the common ingredient list says an ingredient suits.
 * A dish's computed diets are the ones all its ingredients share; nobody types
 * them. Halal and kosher cannot be computed: the chef declares them.
 */
export const COMPUTED_DIETS: readonly ReferenceItem[] = [
  { code: 'vegetarian', label: 'Végétarien' },
  { code: 'vegan', label: 'Végétalien' },
  { code: 'no-pork', label: 'Sans porc' },
  { code: 'pescetarian', label: 'Pescétarien' },
  { code: 'gluten-free', label: 'Sans gluten' },
  { code: 'lactose-free', label: 'Sans lactose' },
];

export const COMPUTED_DIET_CODES = COMPUTED_DIETS.map((d) => d.code);

/** Where a dish sits in a meal, in the order of one. */
export const DISH_CATEGORIES: readonly ReferenceItem[] = [
  { code: 'main', label: 'Plat complet' },
  { code: 'starter', label: 'Entrée' },
  { code: 'soup', label: 'Soupe' },
  { code: 'side', label: 'Accompagnement' },
  { code: 'dessert', label: 'Dessert' },
  { code: 'breakfast', label: 'Petit-déjeuner ou goûter' },
  { code: 'sauce', label: 'Sauce ou base' },
];

/** Fridge storage beyond this many days raises the `FRIDGE_LONG` alert (§4.11). */
export const FRIDGE_ALERT_DAYS = 4;

export const ALLERGEN_CODES = ALLERGENS.map((a) => a.code);
export const DIET_CODES = DIETS.map((d) => d.code);
export const DISH_CATEGORY_CODES = DISH_CATEGORIES.map((c) => c.code);

/** One reason a dish is not ready or cannot be published, as the API reports it. */
export interface PublishProblem {
  code:
    | 'VALIDATION_FAILED'
    | 'ALLERGENS_UNVERIFIED'
    | 'INGREDIENT_TO_VERIFY'
    | 'INGREDIENT_NOT_LINKED'
    | 'INGREDIENT_INCOMPLETE'
    | 'DECLARED_DIET_NOT_ALLOWED'
    | 'STEP_TYPE_MISSING'
    | 'PHOTO_MISSING'
    | 'NO_COMMON_SEASON'
    | 'FRIDGE_LONG';
  field: string;
  message: string;
}

/** The fields a public dish can never lose. */
export interface PublishableDish {
  name: string;
  portions: number;
  allergens: string[];
  allergensNone: boolean;
}

/**
 * What a published dish must keep through an edit: a name and portions. Allergens
 * are computed from the lines, so they are no longer asked here. Publishing itself
 * asks for more, see `readiness`.
 */
export function publishProblems(dish: PublishableDish): PublishProblem[] {
  const problems: PublishProblem[] = [];
  if (!dish.name.trim()) {
    problems.push({
      code: 'VALIDATION_FAILED',
      field: 'name',
      message: 'The name is empty.',
    });
  }
  if (dish.portions < 1) {
    problems.push({
      code: 'VALIDATION_FAILED',
      field: 'portions',
      message: 'A dish serves at least one portion.',
    });
  }
  return problems;
}

/** The fields a write must keep consistent, as they will be once it is applied. */
export interface DeclarationState {
  allergens: string[];
  allergensNone: boolean;
  customAllergens: string[];
  diets: string[];
  customDiets: string[];
}

/** Case, accents and ligatures aside: "oeufs" is "Œufs". */
const normalise = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae');

/** True when a free-text value is only an official entry typed by hand. */
const duplicatesReference = (value: string, list: readonly ReferenceItem[]) => {
  const typed = normalise(value);
  return list.some(
    (item) => normalise(item.code) === typed || normalise(item.label) === typed,
  );
};

/**
 * Contradictions refused at write time, whatever the status: "none of the 14" next
 * to a listed allergen, or an official entry typed as free text next to the list.
 */
export function declarationProblems(state: DeclarationState): string[] {
  const problems: string[] = [];
  if (state.allergensNone && state.allergens.length > 0) {
    problems.push('`allergensNone` cannot be true while `allergens` lists some.');
  }
  for (const value of state.customAllergens) {
    if (duplicatesReference(value, ALLERGENS)) {
      problems.push(
        `"${value}" is a regulated allergen: tick it in \`allergens\` instead.`,
      );
    }
  }
  for (const value of state.customDiets) {
    if (duplicatesReference(value, DIETS)) {
      problems.push(`"${value}" is a listed diet: put it in \`diets\` instead.`);
    }
  }
  return problems;
}

/** The fields the Recettes §4.11 check reads, as `meals` stores them. */
export interface ReadinessDish extends PublishableDish {
  category: string | null;
  cookTime: number | null;
  description: string | null;
  imageUrl: string | null;
  ingredients: unknown;
  steps: unknown;
  storage: unknown;
  reheating: unknown;
  allergensVerifiedAt: Date | null;
  declaredDiets: string[];
  /** The stored `{ diets, seasonMonths }`, or null while not computed. */
  classification: unknown;
  seasonsOverride?: number[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Recettes §4.11, computed and never stored. `problems` keep the recipe from being
 * "Prête"; `toPublish` adds what publishing needs (description, a visible ingredient,
 * the photo); `warnings` block nothing. Origin and
 * equipment are never asked. Every point at once, each naming its field.
 */
export function readiness(dish: ReadinessDish) {
  const problems: PublishProblem[] = [];
  const missing = (field: string, message: string) =>
    problems.push({ code: 'VALIDATION_FAILED', field, message });

  if (!dish.name.trim()) missing('name', 'The name is empty.');
  if (!dish.category) missing('category', 'Choose the type of dish.');
  if (dish.portions < 1) missing('portions', 'A dish serves at least one portion.');
  if (dish.cookTime === null || dish.cookTime === undefined) {
    missing('cookMinutes', 'The cooking time is missing: 0 for a dish not cooked.');
  }

  const lines = readLines(dish.ingredients);
  if (lines.length === 0) missing('recipe.ingredients', 'Add at least one ingredient.');
  lines.forEach((line, i) => {
    const field = `recipe.ingredients[${i}]`;
    if (line.toVerify) {
      problems.push({
        code: 'INGREDIENT_TO_VERIFY',
        field,
        message: 'This ingredient is still to verify.',
      });
    }
    if (!line.catalogIngredientId) {
      problems.push({
        code: 'INGREDIENT_NOT_LINKED',
        field,
        message: 'Link this ingredient to the common list.',
      });
    }
    if (line.incomplete) {
      problems.push({
        code: 'INGREDIENT_INCOMPLETE',
        field,
        message: 'This ingredient lacks the details needed to compute allergens.',
      });
    }
  });

  const steps = readSteps(dish.steps);
  if (steps.length === 0) missing('recipe.steps', 'Add at least one step.');
  steps.forEach((step, i) => {
    if (!step.type) {
      problems.push({
        code: 'STEP_TYPE_MISSING',
        field: `recipe.steps[${i}]`,
        message: 'Say what this step is: preparation, cooking, cooling or packing.',
      });
    }
  });

  const storage = isObject(dish.storage) ? dish.storage : null;
  if (
    !storage ||
    typeof storage.method !== 'string' ||
    typeof storage.days !== 'number'
  ) {
    missing('recipe.storage', 'Say how the dish keeps: how, and for how many days.');
  }
  if (storage && typeof storage.freezable !== 'boolean') {
    missing('recipe.storage.freezable', 'Say whether the dish can be frozen.');
  } else if (storage?.freezable === true) {
    if (typeof storage.freezerMonths !== 'number') {
      missing('recipe.storage.freezerMonths', 'Say for how many months it freezes.');
    }
    if (typeof storage.thawing !== 'string' || !storage.thawing.trim()) {
      missing('recipe.storage.thawing', 'Say how to thaw it.');
    }
  }

  const reheating = isObject(dish.reheating) ? dish.reheating : null;
  const modes = Array.isArray(reheating?.modes) ? reheating.modes : [];
  if (modes.length === 0 && typeof reheating?.mode !== 'string') {
    missing('recipe.reheating', 'Choose how to reheat it.');
  }
  if (reheating && (typeof reheating.note !== 'string' || !reheating.note.trim())) {
    missing('recipe.reheating.note', 'Add a reheating note.');
  }

  // Halal and kosher cannot be computed, but it cannot contradict the ingredients: no pork.
  const computedDiets =
    isObject(dish.classification) && Array.isArray(dish.classification.diets)
      ? dish.classification.diets
      : [];
  if (
    dish.declaredDiets.some((diet) => diet === 'halal' || diet === 'kosher') &&
    !computedDiets.includes('no-pork')
  ) {
    problems.push({
      code: 'DECLARED_DIET_NOT_ALLOWED',
      field: 'declaredDiets',
      message: 'Halal or kosher needs ingredients without pork.',
    });
  }

  // Allergens are computed from the lines; only their confirmation is asked.
  if (!dish.allergensVerifiedAt) {
    problems.push({
      code: 'ALLERGENS_UNVERIFIED',
      field: 'allergens',
      message: 'Confirm the allergens: the ingredients changed since they were verified.',
    });
  }

  const toPublish: PublishProblem[] = [];
  if (!dish.description?.trim()) {
    toPublish.push({
      code: 'VALIDATION_FAILED',
      field: 'description',
      message: 'A short description is needed to publish.',
    });
  }
  if (lines.length > 0 && lines.every((line) => line.hiddenFromClient)) {
    toPublish.push({
      code: 'VALIDATION_FAILED',
      field: 'recipe.ingredients',
      message: 'At least one ingredient must be visible to the client.',
    });
  }
  if (!dish.imageUrl) {
    toPublish.push({
      code: 'PHOTO_MISSING',
      field: 'imageUrl',
      message: 'A real photo of the dish is required, not a generated image.',
    });
  }

  const warnings: PublishProblem[] = [];
  if (
    isObject(dish.classification) &&
    Array.isArray(dish.classification.seasonMonths) &&
    dish.classification.seasonMonths.length === 0 &&
    !dish.seasonsOverride?.length
  ) {
    warnings.push({
      code: 'NO_COMMON_SEASON',
      field: 'classification',
      message: 'The ingredients share no season: choose the seasons by hand.',
    });
  }
  if (
    storage?.method === 'fridge' &&
    typeof storage.days === 'number' &&
    storage.days > FRIDGE_ALERT_DAYS
  ) {
    warnings.push({
      code: 'FRIDGE_LONG',
      field: 'recipe.storage',
      message: `Fridge storage beyond ${FRIDGE_ALERT_DAYS} days: check it is safe.`,
    });
  }
  return { ready: problems.length === 0, problems, toPublish, warnings };
}

/** Computed, never stored: at least one ingredient and one step (§3.3). */
export function isRecipeComplete(ingredients: unknown, steps: unknown[]): boolean {
  return Array.isArray(ingredients) && ingredients.length > 0 && steps.length > 0;
}
