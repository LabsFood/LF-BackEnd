import {
  ALLERGEN_CODES,
  declarationProblems,
  isRecipeComplete,
  publishProblems,
  readiness,
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
      portions: 0,
      allergens: [],
      allergensNone: false,
    });
    expect(problems.map((p) => p.field)).toEqual(['name', 'portions', 'allergens']);
  });
});

describe('readiness (Recettes §4.11)', () => {
  const ail = { name: 'Ail', qty: 4, unit: 'gousse', aisle: 'fruits-legumes' };
  const step = {
    order: 1,
    text: 'Enfourner 55 min.',
    type: 'cuisson',
    durationMinutes: 55,
  };
  const DISH = {
    name: 'Poulet rôti aux herbes',
    category: 'main',
    portions: 3,
    cookTime: 55,
    description: 'Poulet fermier rôti, thym et romarin.',
    imageUrl: 'https://photos.example.com/poulet.jpg',
    ingredients: [ail],
    steps: [step],
    storage: { method: 'fridge', days: 3 },
    reheating: { modes: ['oven'] },
    allergens: ['celery'],
    allergensNone: false,
    allergensVerifiedAt: new Date('2026-11-01T09:00:00.000Z'),
  };

  it('is ready when every point is met; origin and equipment are never asked', () => {
    expect(readiness(DISH)).toEqual({
      ready: true,
      problems: [],
      toPublish: [],
      warnings: [],
    });
  });

  it('lists every missing point at once, each pointing at its field', () => {
    const result = readiness({
      ...DISH,
      name: ' ',
      category: null,
      cookTime: null,
      ingredients: [],
      steps: [],
      storage: null,
      reheating: null,
      allergens: [],
      allergensVerifiedAt: null,
    });

    expect(result.ready).toBe(false);
    expect(result.problems.map((p) => [p.code, p.field])).toEqual([
      ['VALIDATION_FAILED', 'name'],
      ['VALIDATION_FAILED', 'category'],
      ['VALIDATION_FAILED', 'cookMinutes'],
      ['VALIDATION_FAILED', 'recipe.ingredients'],
      ['VALIDATION_FAILED', 'recipe.steps'],
      ['VALIDATION_FAILED', 'recipe.storage'],
      ['VALIDATION_FAILED', 'recipe.reheating'],
      ['ALLERGENS_REQUIRED', 'allergens'],
    ]);
  });

  it('points at each ingredient to verify and each step without a type', () => {
    const result = readiness({
      ...DISH,
      ingredients: [ail, { ...ail, name: 'Sel', toVerify: true }],
      steps: ['Éplucher', step],
    });

    expect(result.problems).toEqual([
      expect.objectContaining({
        code: 'INGREDIENT_TO_VERIFY',
        field: 'recipe.ingredients[1]',
      }),
      expect.objectContaining({ code: 'STEP_TYPE_MISSING', field: 'recipe.steps[0]' }),
    ]);
  });

  it('asks for the allergens to be verified again after an ingredient change', () => {
    expect(readiness({ ...DISH, allergensVerifiedAt: null }).problems).toEqual([
      expect.objectContaining({ code: 'ALLERGENS_UNVERIFIED', field: 'allergens' }),
    ]);
  });

  it('needs a short description to publish, and only warns about the photo for now', () => {
    const result = readiness({ ...DISH, description: ' ', imageUrl: null });

    expect(result.ready).toBe(true);
    expect(result.toPublish).toEqual([
      expect.objectContaining({ code: 'VALIDATION_FAILED', field: 'description' }),
    ]);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'PHOTO_MISSING', field: 'imageUrl' }),
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
