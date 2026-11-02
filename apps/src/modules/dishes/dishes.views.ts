import { Meal } from '../../generated/prisma/client';
import { isRecipeComplete } from './domain/dishes.rules';

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
  return {
    ...toDishSummary(meal),
    recipe: {
      ingredients,
      steps: meal.steps,
      reheating: meal.reheating,
      storage: meal.storage,
    },
    recipeComplete: isRecipeComplete(ingredients, meal.steps),
    /** +1 on every recipe change; a booking pins the one it was cooked from (§9.2). */
    recipeVersion: meal.recipeVersion,
    isFeatured: meal.isFeatured,
    status: meal.status,
    publishedAt: meal.publishedAt,
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
