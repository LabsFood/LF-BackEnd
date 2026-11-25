import { mealCountProblem } from './meal-count.rules';

describe('mealCountProblem', () => {
  it('lets an offer without a fixed count take any number of dishes', () => {
    expect(mealCountProblem(null, 7, 2)).toBeNull();
  });

  it('takes exactly the dishes the offer includes', () => {
    expect(mealCountProblem(3, 3, 0)).toBeNull();
  });

  it('refuses fewer or more dishes than the offer includes', () => {
    expect(mealCountProblem(3, 2, 0)).toBe('MEAL_COUNT_MISMATCH');
    expect(mealCountProblem(3, 4, 0)).toBe('MEAL_COUNT_MISMATCH');
  });

  it('leaves the dishes to choose later with the batch cooker', () => {
    expect(mealCountProblem(3, 0, 0)).toBeNull();
  });

  it('refuses extra dishes on a fixed count: the offer is the count', () => {
    expect(mealCountProblem(3, 3, 1)).toBe('EXTRA_MEALS_NOT_OFFERED');
  });
});
