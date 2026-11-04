import { Meal } from '../../generated/prisma/client';
import { isRecipeComplete, readiness } from './domain/dishes.rules';
import { Classification, unlinkedLines } from './domain/classification.rules';
import { readSteps } from './domain/recipes.rules';
import { allergenStateOf } from './domain/allergens.rules';
import { readLines } from './domain/recipe-lines.rules';

const computed = (meal: Meal) => meal.classification as Classification | null;

/** The seasons shown: the chef's months if set, else the computed ones (null: unknown). */
const seasonsOf = (meal: Meal) =>
  meal.seasonsOverride.length
    ? meal.seasonsOverride
    : (computed(meal)?.seasonMonths ?? null);

/**
 * How a dish is shown, per audience. The column names of `meals` predate FLOW-02
 * (`prep_time`, `dietary_tags`), so the wire names of the spec are mapped here and
 * nowhere else.
 */

/**
 * Everything the public may see (§1): no ingredients, no steps. An explicit list:
 * Recettes lot 0 keeps the times and calories off the storefront, portions stay.
 */
export function toPublicDish(meal: Meal) {
  return {
    id: meal.id,
    name: meal.name,
    description: meal.description,
    continent: meal.continent,
    country: meal.country,
    category: meal.category,
    imageUrl: meal.imageUrl,
    portions: meal.portions,
    difficulty: meal.difficulty,
    diets: meal.dietaryTags,
    customDiets: meal.customDiets,
    allergens: meal.allergens,
    allergensNone: meal.allergensNone,
    customAllergens: meal.customAllergens,
    /** Allergens only optional lines bring (§6.2): still inside `allergens`. */
    conditionalAllergens: meal.conditionalAllergens,
    /** Recettes §4.8: computed from the common list; null while not computable. */
    computedDiets: computed(meal)?.diets ?? null,
    declaredDiets: meal.declaredDiets,
    seasonMonths: seasonsOf(meal),
    profiles: meal.profiles,
  };
}

/** The public fields plus the times and calories, which only chefs and admins see. */
export function toDishSummary(meal: Meal) {
  return {
    ...toPublicDish(meal),
    prepMinutes: meal.prepTime,
    cookMinutes: meal.cookTime,
    calories: meal.calories,
  };
}

/** The chef's own view, and the admin's (§8): with the recipe and the status. */
export function toDishView(meal: Meal) {
  const ingredients = Array.isArray(meal.ingredients) ? meal.ingredients : [];
  const steps = readSteps(meal.steps);
  return {
    ...toDishSummary(meal),
    recipe: {
      ingredients,
      steps,
      reheating: meal.reheating,
      storage: meal.storage,
    },
    /** Free text, never checked (Recettes §4.7). */
    equipment: meal.equipment,
    /** The ones the chef added on top of the computed ones. */
    addedAllergens: meal.addedAllergens,
    /** Per allergen, the ingredients that bring it. */
    allergenSources: allergenStateOf(
      readLines(meal.ingredients),
      meal.addedAllergens,
      meal.customAllergens,
    ).sources,
    /** The version a save must send back (`lockVersion`) to prove it read the latest. */
    lockVersion: meal.lockVersion,
    /** The chef's alone: never on the storefront. */
    personalTags: meal.personalTags,
    /** Recettes §4.8: what was computed, and what is left to link to compute it. */
    classification: {
      computedSeasonMonths: computed(meal)?.seasonMonths ?? null,
      seasonsOverride: meal.seasonsOverride,
      unlinkedLines: unlinkedLines(meal.ingredients),
    },
    /** Recettes §4.9: null until the chef confirms, and after an ingredient change. */
    allergensVerifiedAt: meal.allergensVerifiedAt,
    recipeComplete: isRecipeComplete(ingredients, steps),
    /**
     * Recettes R6: the last version made, the one a booking pins (§9.2). A new one
     * is made once the recipe is "Prête" again; `versionPending` says changes wait.
     */
    recipeVersion: meal.recipeVersion,
    versionPending: meal.versionPending,
    /** Recettes §4.11: what keeps it from "Prête", and what publishing adds. */
    readiness: readiness(meal),
    isFeatured: meal.isFeatured,
    status: meal.status,
    publishedAt: meal.publishedAt,
    /** Recettes §5.4: the dish this one was copied from, if any. */
    variantOfId: meal.variantOfId,
    /** `labs-food` for a copy of a Lab's Food suggestion (§6). */
    origin: meal.sourceMealId ? ('labs-food' as const) : ('own' as const),
    /** Set when that suggestion later changed its allergens, diets or country. */
    sourceChangedAt: meal.sourceChangedAt,
    /** §4.3: why an admin took it down, shown to the chef as written. */
    moderation: toModeration(meal),
    createdAt: meal.createdAt,
    updatedAt: meal.updatedAt,
  };
}

/** The removal an admin made, while it stands; `null` otherwise. */
export function toModeration(content: {
  status: string;
  moderationReason: string | null;
  moderationReasonCode: string | null;
  moderatedAt: Date | null;
}) {
  return content.status === 'suspended'
    ? {
        reason: content.moderationReason,
        reasonCode: content.moderationReasonCode,
        at: content.moderatedAt,
      }
    : null;
}
