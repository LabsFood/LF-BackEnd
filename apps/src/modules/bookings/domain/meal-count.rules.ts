/** Why a booking's dishes do not fit its offer. */
export type MealCountProblem = 'MEAL_COUNT_MISMATCH' | 'EXTRA_MEALS_NOT_OFFERED';

/**
 * An offer with `mealsIncluded` is a package of that many dishes (« Douceur : 3
 * repas »): the client picks exactly that many, or none yet to settle with the batch
 * cooker, and buys no extra dish on top. Persons and portions still move freely.
 * An offer without it (`null`, the offers made before 19/11) takes any count.
 */
export function mealCountProblem(
  mealsIncluded: number | null,
  chosen: number,
  extraMeals: number,
): MealCountProblem | null {
  if (mealsIncluded == null) return null;
  if (extraMeals > 0) return 'EXTRA_MEALS_NOT_OFFERED';
  if (chosen > 0 && chosen !== mealsIncluded) return 'MEAL_COUNT_MISMATCH';
  return null;
}
