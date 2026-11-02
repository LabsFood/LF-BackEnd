/**
 * Pure rules behind FLOW-02. No database, no I/O: everything here is a function of
 * a dish or menu as stored, so the checks in §3.3 and §3.4 can be read against the
 * tests next to this file.
 */

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
  { code: 'starter', label: 'Entrée' },
  { code: 'main', label: 'Plat' },
  { code: 'side', label: 'Accompagnement' },
  { code: 'dessert', label: 'Dessert' },
];

export const ALLERGEN_CODES = ALLERGENS.map((a) => a.code);
export const DIET_CODES = DIETS.map((d) => d.code);
export const DISH_CATEGORY_CODES = DISH_CATEGORIES.map((c) => c.code);

/** One reason a dish is not ready or cannot be published, as the API reports it. */
export interface PublishProblem {
  code:
    | 'VALIDATION_FAILED'
    | 'ALLERGENS_REQUIRED'
    | 'ALLERGENS_UNVERIFIED'
    | 'INGREDIENT_TO_VERIFY'
    | 'STEP_TYPE_MISSING'
    | 'PHOTO_MISSING';
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
 * What a published dish must keep through an edit: a name, portions, an allergen
 * declaration. Publishing itself asks for more, see `readiness`. The country of
 * origin is optional since Recettes lot 2 ("Non spécifié").
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
  // Free-text allergens never count: the 14 regulated ones must be answered, even
  // if only to say "none of them".
  if (dish.allergens.length === 0 && !dish.allergensNone) {
    problems.push({
      code: 'ALLERGENS_REQUIRED',
      field: 'allergens',
      message:
        'Declare the allergens: list them, or confirm the dish contains none of the 14 ' +
        'regulated allergens (`allergensNone: true`).',
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
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Recettes §4.11, computed and never stored. `problems` keep the recipe from being
 * "Prête"; `toPublish` adds what publishing needs on top; `warnings` block nothing
 * yet (a real photo is required, not blocking at first: BLK-32). Origin and
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

  const ingredients = Array.isArray(dish.ingredients) ? dish.ingredients : [];
  if (ingredients.length === 0)
    missing('recipe.ingredients', 'Add at least one ingredient.');
  ingredients.forEach((line, i) => {
    if (isObject(line) && line.toVerify === true) {
      problems.push({
        code: 'INGREDIENT_TO_VERIFY',
        field: `recipe.ingredients[${i}]`,
        message: 'This ingredient is still to verify.',
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
  const reheating = isObject(dish.reheating) ? dish.reheating : null;
  const modes = Array.isArray(reheating?.modes) ? reheating.modes : [];
  if (modes.length === 0 && typeof reheating?.mode !== 'string') {
    missing('recipe.reheating', 'Choose how to reheat it.');
  }

  if (dish.allergens.length === 0 && !dish.allergensNone) {
    problems.push({
      code: 'ALLERGENS_REQUIRED',
      field: 'allergens',
      message:
        'Declare the allergens: list them, or confirm the dish contains none of the 14 ' +
        'regulated allergens (`allergensNone: true`).',
    });
  } else if (!dish.allergensVerifiedAt) {
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
  const warnings: PublishProblem[] = [];
  if (!dish.imageUrl) {
    warnings.push({
      code: 'PHOTO_MISSING',
      field: 'imageUrl',
      message: 'A real photo of the dish is required, not a generated image.',
    });
  }
  return { ready: problems.length === 0, problems, toPublish, warnings };
}

/** Computed, never stored: at least one ingredient and one step (§3.3). */
export function isRecipeComplete(ingredients: unknown, steps: unknown[]): boolean {
  return Array.isArray(ingredients) && ingredients.length > 0 && steps.length > 0;
}
