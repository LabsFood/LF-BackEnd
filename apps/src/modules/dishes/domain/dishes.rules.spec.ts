import {
  ALLERGEN_CODES,
  declarationProblems,
  DISH_CATEGORIES,
  FRIDGE_ALERT_DAYS,
  isRecipeComplete,
  publishProblems,
  readiness,
  ReadinessDish,
} from './dishes.rules';

const READY = {
  name: 'Poulet rôti aux herbes',
  country: 'FR',
  portions: 3,
};

describe('publishProblems (FLOW-02 §3.3)', () => {
  it('passes a complete dish', () => {
    expect(publishProblems(READY)).toEqual([]);
  });

  it('asks only for a name and portions: allergens are computed', () => {
    expect(publishProblems({ name: 'Poulet', portions: 1 })).toEqual([]);
  });

  it('reports every problem at once, not the first one', () => {
    const problems = publishProblems({
      name: '  ',
      portions: 0,
    });
    expect(problems.map((p) => p.field)).toEqual(['name', 'portions']);
  });
});

describe('DISH_CATEGORIES', () => {
  it('lists the seven types of dish, in order', () => {
    expect(DISH_CATEGORIES.map((c) => [c.code, c.label])).toEqual([
      ['main', 'Plat complet'],
      ['starter', 'Entrée'],
      ['soup', 'Soupe'],
      ['side', 'Accompagnement'],
      ['dessert', 'Dessert'],
      ['breakfast', 'Petit-déjeuner ou goûter'],
      ['sauce', 'Sauce ou base'],
    ]);
  });
});

describe('readiness (Recettes §4.11)', () => {
  const ail = {
    name: 'Ail',
    qty: 4,
    unit: 'clove',
    aisle: 'fruits-legumes',
    catalogIngredientId: 'cat-1',
    allergens: [],
    incomplete: false,
  };
  const step = {
    order: 1,
    text: 'Enfourner 55 min.',
    type: 'cuisson',
    durationMinutes: 55,
  };
  const DISH: ReadinessDish = {
    name: 'Poulet rôti aux herbes',
    category: 'main',
    portions: 3,
    cookTime: 55,
    description: 'Poulet fermier rôti, thym et romarin.',
    imageUrl: 'https://photos.example.com/poulet.jpg',
    ingredients: [ail],
    steps: [step],
    storage: { method: 'fridge', days: 3, freezable: false },
    reheating: { modes: ['oven'], note: 'Couvrir de papier alu.' },
    allergensVerifiedAt: new Date('2026-11-01T09:00:00.000Z'),
    declaredDiets: [],
    classification: { diets: ['no-pork'], seasonMonths: [1, 2, 3] },
    seasonsOverride: [],
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
      ['ALLERGENS_UNVERIFIED', 'allergens'],
    ]);
  });

  it('never asks the chef to declare allergens: they are computed', () => {
    expect(readiness(DISH).problems.map((p) => p.code)).not.toContain(
      'ALLERGENS_REQUIRED',
    );
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

  it('points at a line not linked to the common list', () => {
    const result = readiness({
      ...DISH,
      ingredients: [ail, { ...ail, name: 'Sel', catalogIngredientId: null }],
    });
    expect(result.problems).toEqual([
      expect.objectContaining({
        code: 'INGREDIENT_NOT_LINKED',
        field: 'recipe.ingredients[1]',
      }),
    ]);
  });

  it('points at an incomplete line', () => {
    const result = readiness({ ...DISH, ingredients: [{ ...ail, incomplete: true }] });
    expect(result.problems).toEqual([
      expect.objectContaining({
        code: 'INGREDIENT_INCOMPLETE',
        field: 'recipe.ingredients[0]',
      }),
    ]);
  });

  it('asks whether the dish can be frozen', () => {
    const result = readiness({ ...DISH, storage: { method: 'fridge', days: 3 } });
    expect(result.problems).toEqual([
      expect.objectContaining({
        code: 'VALIDATION_FAILED',
        field: 'recipe.storage.freezable',
      }),
    ]);
  });

  it('asks for the freezer months and the thawing when it can be frozen', () => {
    const result = readiness({
      ...DISH,
      storage: { method: 'fridge', days: 3, freezable: true },
    });
    expect(result.problems.map((p) => [p.code, p.field])).toEqual([
      ['VALIDATION_FAILED', 'recipe.storage.freezerMonths'],
      ['VALIDATION_FAILED', 'recipe.storage.thawing'],
    ]);
  });

  it('accepts a freezable dish with its months and thawing', () => {
    const result = readiness({
      ...DISH,
      storage: {
        method: 'fridge',
        days: 3,
        freezable: true,
        freezerMonths: 3,
        thawing: 'fridge',
      },
    });
    expect(result.problems).toEqual([]);
  });

  it('asks for a reheating note', () => {
    const result = readiness({ ...DISH, reheating: { modes: ['oven'], note: '  ' } });
    expect(result.problems).toEqual([
      expect.objectContaining({
        code: 'VALIDATION_FAILED',
        field: 'recipe.reheating.note',
      }),
    ]);
  });

  describe('declared diets', () => {
    it('refuses halal when the classification does not say no-pork', () => {
      const result = readiness({
        ...DISH,
        declaredDiets: ['halal'],
        classification: { diets: ['vegetarian'], seasonMonths: [1] },
      });
      expect(result.problems).toEqual([
        expect.objectContaining({
          code: 'DECLARED_DIET_NOT_ALLOWED',
          field: 'declaredDiets',
        }),
      ]);
    });

    it('refuses halal while the classification is not computed', () => {
      const result = readiness({
        ...DISH,
        declaredDiets: ['halal'],
        classification: null,
      });
      expect(result.problems).toEqual([
        expect.objectContaining({ code: 'DECLARED_DIET_NOT_ALLOWED' }),
      ]);
    });

    it('refuses kosher too, and reports halal plus kosher once', () => {
      const noPork = { diets: ['vegetarian'], seasonMonths: [1] };
      for (const declaredDiets of [['kosher'], ['halal', 'kosher']]) {
        const result = readiness({ ...DISH, declaredDiets, classification: noPork });
        expect(result.problems).toEqual([
          expect.objectContaining({
            code: 'DECLARED_DIET_NOT_ALLOWED',
            field: 'declaredDiets',
          }),
        ]);
      }
      expect(readiness({ ...DISH, declaredDiets: ['kosher'] }).problems).toEqual([]);
    });

    it('accepts halal with no-pork', () => {
      expect(readiness({ ...DISH, declaredDiets: ['halal'] }).problems).toEqual([]);
    });
  });

  describe('to publish', () => {
    it('needs a short description', () => {
      const result = readiness({ ...DISH, description: ' ' });
      expect(result.ready).toBe(true);
      expect(result.toPublish).toEqual([
        expect.objectContaining({ code: 'VALIDATION_FAILED', field: 'description' }),
      ]);
    });

    it('refuses a recipe whose lines are all hidden from the client', () => {
      const result = readiness({
        ...DISH,
        ingredients: [{ ...ail, hiddenFromClient: true }],
      });
      expect(result.ready).toBe(true);
      expect(result.toPublish).toEqual([
        expect.objectContaining({
          code: 'VALIDATION_FAILED',
          field: 'recipe.ingredients',
        }),
      ]);
    });

    it('needs a real photo: PHOTO_MISSING is no longer only a warning', () => {
      const result = readiness({ ...DISH, imageUrl: null });
      expect(result.ready).toBe(true);
      expect(result.toPublish).toEqual([
        expect.objectContaining({ code: 'PHOTO_MISSING', field: 'imageUrl' }),
      ]);
      expect(result.warnings).toEqual([]);
    });
  });

  describe('alerts', () => {
    it('warns when the ingredients share no season', () => {
      const result = readiness({
        ...DISH,
        classification: { diets: [], seasonMonths: [] },
      });
      expect(result.ready).toBe(true);
      expect(result.warnings).toEqual([
        expect.objectContaining({ code: 'NO_COMMON_SEASON' }),
      ]);
    });

    it('does not warn when the chef overrides the seasons, or nothing is computed', () => {
      const none = { diets: [], seasonMonths: [] };
      expect(
        readiness({ ...DISH, classification: none, seasonsOverride: [6, 7] }).warnings,
      ).toEqual([]);
      expect(readiness({ ...DISH, classification: null }).warnings).toEqual([]);
    });

    it('warns when the fridge storage is longer than four days', () => {
      expect(FRIDGE_ALERT_DAYS).toBe(4);
      expect(
        readiness({ ...DISH, storage: { method: 'fridge', days: 5, freezable: false } })
          .warnings,
      ).toEqual([expect.objectContaining({ code: 'FRIDGE_LONG' })]);
      expect(
        readiness({ ...DISH, storage: { method: 'fridge', days: 4, freezable: false } })
          .warnings,
      ).toEqual([]);
    });
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
