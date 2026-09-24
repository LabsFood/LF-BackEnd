/**
 * Response examples for the FLOW-02 routes in Swagger. They copy the shapes the
 * views in `dishes.views.ts` return: change them together.
 */

export const DISH_ID = '5b1f3c2e-8a44-4d0e-9f21-3c6a7e9b0d12';

export const RECIPE_EXAMPLE = {
  ingredients: [
    { name: 'Poulet fermier entier', qty: 1.4, unit: 'kg', aisle: 'boucherie' },
    { name: 'Pommes de terre grenaille', qty: 800, unit: 'g', aisle: 'fruits-legumes' },
    { name: 'Ail', qty: 4, unit: 'gousse', aisle: 'fruits-legumes' },
  ],
  steps: [
    'Préchauffer le four à 200 °C.',
    "Glisser le beurre, l'ail écrasé et les herbes sous la peau du poulet.",
    'Enfourner 55 min en arrosant deux fois avec le jus.',
  ],
  reheating: { mode: 'oven', temperature: 160, minutes: 15, note: 'Couvrir.' },
  storage: { method: 'fridge', days: 3, container: 'Boîte hermétique' },
};

export const PUBLIC_DISH_EXAMPLE = {
  id: DISH_ID,
  name: 'Poulet rôti aux herbes',
  description: 'Poulet fermier rôti, thym et romarin, pommes de terre grenaille.',
  country: 'FR',
  category: 'main',
  imageUrl: null,
  portions: 3,
  prepMinutes: 20,
  cookMinutes: 55,
  difficulty: 'easy',
  diets: ['lactose-free'],
  customDiets: [],
  allergens: ['celery'],
  allergensNone: false,
  customAllergens: ['sarrasin'],
};

/** `GET /me/dishes/{id}` → 200. */
export const DISH_EXAMPLE = {
  ...PUBLIC_DISH_EXAMPLE,
  recipe: RECIPE_EXAMPLE,
  recipeComplete: true,
  status: 'published',
  publishedAt: '2026-09-20T14:02:11.000Z',
  createdAt: '2026-09-19T08:40:00.000Z',
  updatedAt: '2026-09-20T14:02:11.000Z',
};

/** `POST /me/dishes/{id}/publish` → 422. */
export const PUBLISH_REFUSED_EXAMPLE = {
  code: 'ALLERGENS_REQUIRED',
  message: 'This dish cannot be published yet.',
  problems: [
    {
      code: 'ALLERGENS_REQUIRED',
      field: 'allergens',
      message:
        'Declare the allergens: list them, or confirm the dish contains none of the 14 ' +
        'regulated allergens (`allergensNone: true`).',
    },
  ],
};

export const CHEF_NOT_VERIFIED_EXAMPLE = {
  code: 'CHEF_NOT_VERIFIED',
  message: 'Your candidature must be approved before you can write dishes or menus.',
};

export const CONTENT_NOT_OWNED_EXAMPLE = {
  code: 'CONTENT_NOT_OWNED',
  message: 'This dish is not yours.',
};
