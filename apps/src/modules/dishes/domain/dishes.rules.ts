/**
 * Pure rules behind FLOW-02. No database, no I/O: everything here is a function of
 * a dish or menu as stored, so the checks in §3.3 and §3.4 can be read against the
 * tests next to this file.
 */

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

/** One reason a dish cannot be published, as the API reports it. */
export interface PublishProblem {
  code: 'VALIDATION_FAILED' | 'ALLERGENS_REQUIRED';
  field: string;
  message: string;
}

/** The fields the §3.3 checks read. */
export interface PublishableDish {
  name: string;
  country: string | null;
  portions: number;
  allergens: string[];
  allergensNone: boolean;
}

/**
 * The blocking checks of §3.3 that depend on the dish itself; whether the chef may
 * publish at all is checked before, by the caller. Returns every problem, not the
 * first, so the chef fixes the dish in one go. The recipe is not required: a dish
 * can be shown before its fiche is written.
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
  if (!dish.country) {
    problems.push({
      code: 'VALIDATION_FAILED',
      field: 'country',
      message: 'The country of origin is missing. It colours the client’s culinary map.',
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

/** Computed, never stored: at least one ingredient and one step (§3.3). */
export function isRecipeComplete(ingredients: unknown, steps: string[]): boolean {
  return Array.isArray(ingredients) && ingredients.length > 0 && steps.length > 0;
}
