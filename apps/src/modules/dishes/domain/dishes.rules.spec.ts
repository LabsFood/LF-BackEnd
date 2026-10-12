import {
  ALLERGEN_CODES,
  declarationProblems,
  isRecipeComplete,
  publishProblems,
} from './dishes.rules';

const READY = {
  name: 'Poulet rôti aux herbes',
  country: 'FR',
  portions: 3,
  allergens: ['celery'],
  allergensNone: false,
};

describe('publishProblems (FLOW-02 §3.3)', () => {
  it('passes a complete dish', () => {
    expect(publishProblems(READY)).toEqual([]);
  });

  it('accepts an explicit "none of the 14" instead of a list', () => {
    expect(publishProblems({ ...READY, allergens: [], allergensNone: true })).toEqual([]);
  });

  it('refuses an unanswered allergen declaration with ALLERGENS_REQUIRED', () => {
    expect(publishProblems({ ...READY, allergens: [] })).toEqual([
      expect.objectContaining({ code: 'ALLERGENS_REQUIRED', field: 'allergens' }),
    ]);
  });

  it('reports every problem at once, not the first one', () => {
    const problems = publishProblems({
      name: '  ',
      country: null,
      portions: 0,
      allergens: [],
      allergensNone: false,
    });
    expect(problems.map((p) => p.field)).toEqual([
      'name',
      'country',
      'portions',
      'allergens',
    ]);
  });
});

describe('declarationProblems', () => {
  const clean = {
    allergens: ['milk'],
    allergensNone: false,
    customAllergens: ['sarrasin'],
    diets: ['vegetarian'],
    customDiets: ['pescetarien'],
  };

  it('accepts free-text values that are not in the lists', () => {
    expect(declarationProblems(clean)).toEqual([]);
  });

  it('refuses "none of the 14" next to a listed allergen', () => {
    expect(declarationProblems({ ...clean, allergensNone: true })).toHaveLength(1);
  });

  it('refuses an official allergen typed as free text, by code or by label', () => {
    expect(declarationProblems({ ...clean, customAllergens: ['Gluten'] })).toHaveLength(
      1,
    );
    expect(declarationProblems({ ...clean, customAllergens: ['oeufs'] })).toHaveLength(1);
  });

  it('refuses a listed diet typed as free text', () => {
    expect(declarationProblems({ ...clean, customDiets: ['Sans gluten'] })).toHaveLength(
      1,
    );
  });
});

describe('isRecipeComplete', () => {
  it('needs at least one ingredient and one step', () => {
    expect(isRecipeComplete([{ name: 'Ail' }], ['Éplucher'])).toBe(true);
    expect(isRecipeComplete([], ['Éplucher'])).toBe(false);
    expect(isRecipeComplete([{ name: 'Ail' }], [])).toBe(false);
    expect(isRecipeComplete({}, ['Éplucher'])).toBe(false);
  });
});

it('lists the 14 regulated allergens', () => {
  expect(new Set(ALLERGEN_CODES).size).toBe(14);
});
