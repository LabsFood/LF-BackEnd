import { Meal } from '../../generated/prisma/client';
import { isRecipeComplete } from './domain/dishes.rules';

/**
 * How a dish is shown, per audience. The column names of `meals` predate FLOW-02
 * (`prep_time`, `dietary_tags`), so the wire names of the spec are mapped here and
 * nowhere else.
 */

/** Everything the public may see (§1): no ingredients, no steps. */
export function toPublicDish(meal: Meal) {
  return {
    id: meal.id,
    name: meal.name,
    description: meal.description,
    country: meal.country,
    category: meal.category,
    imageUrl: meal.imageUrl,
    portions: meal.portions,
    prepMinutes: meal.prepTime,
    cookMinutes: meal.cookTime,
    difficulty: meal.difficulty,
    diets: meal.dietaryTags,
    customDiets: meal.customDiets,
    allergens: meal.allergens,
    allergensNone: meal.allergensNone,
    customAllergens: meal.customAllergens,
  };
}

/** The chef's own view, and the admin's (§8): with the recipe and the status. */
export function toDishView(meal: Meal) {
  const ingredients = Array.isArray(meal.ingredients) ? meal.ingredients : [];
  return {
    ...toPublicDish(meal),
    recipe: {
      ingredients,
      steps: meal.steps,
      reheating: meal.reheating,
      storage: meal.storage,
    },
    recipeComplete: isRecipeComplete(ingredients, meal.steps),
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
