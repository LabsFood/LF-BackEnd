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
  continent: 'europe',
  country: 'FR',
  category: 'main',
  imageUrl: null,
  portions: 3,
  prepMinutes: 20,
  cookMinutes: 55,
  difficulty: 'easy',
  calories: 640,
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
  recipeVersion: 3,
  isFeatured: false,
  status: 'published',
  publishedAt: '2026-09-20T14:02:11.000Z',
  origin: 'own',
  sourceChangedAt: null,
  moderation: null,
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

export const MENU_ID = '3a9d7f10-2c4b-4e8a-9b61-0f5e2d7c8a31';

/** `GET /me/menus/{id}` → 200. */
export const MENU_EXAMPLE = {
  id: MENU_ID,
  title: 'Semaine méditerranéenne',
  pitch: 'Une semaine qui voyage : Vietnam, Sénégal, Tunisie, puis retour en Provence.',
  imageUrl: null,
  period: 'week',
  status: 'published',
  shoppingIncluded: true,
  publishedAt: '2026-09-21T07:30:00.000Z',
  moderation: null,
  createdAt: '2026-09-20T18:02:00.000Z',
  updatedAt: '2026-09-21T07:30:00.000Z',
  dishes: [DISH_EXAMPLE],
};

/** `POST /me/menus/{id}/publish` → 422. */
export const MENU_NOT_PUBLISHABLE_EXAMPLE = {
  code: 'MENU_NOT_PUBLISHABLE',
  message: 'This menu cannot be published as it is.',
  problems: {
    menu: [],
    dishes: [
      {
        dishId: DISH_ID,
        name: 'Poulet rôti aux herbes',
        problems: [
          {
            code: 'ALLERGENS_REQUIRED',
            field: 'allergens',
            message:
              'Declare the allergens: list them, or confirm the dish contains none of ' +
              'the 14 regulated allergens (`allergensNone: true`).',
          },
        ],
      },
    ],
  },
};

/** `GET /me/showcase/weeks` → 200. */
export const SHOWCASE_EXAMPLE = {
  from: '2026-09-28',
  to: '2026-11-16',
  weeks: [
    {
      weekStart: '2026-09-28',
      menu: { id: MENU_ID, title: 'Semaine méditerranéenne', status: 'published' },
    },
    { weekStart: '2026-10-05', menu: null },
  ],
};

/** `GET /me/suggestions` → 200. */
export const SUGGESTIONS_EXAMPLE = {
  dishes: [
    {
      ...PUBLIC_DISH_EXAMPLE,
      id: 'd3eebc99-9c0b-4ef8-bb6d-6bb9bd380a44',
      name: 'Poulet yassa',
      country: 'SN',
      updatedAt: '2026-09-03T14:12:00.000Z',
      adoptedCopyId: null,
    },
  ],
  menus: [
    {
      id: '8c1e2f40-7a3b-4d5c-9e6f-1a2b3c4d5e6f',
      title: 'Tour du monde en sept plats',
      pitch: 'Une semaine qui voyage.',
      period: 'week',
      updatedAt: '2026-09-10T09:00:00.000Z',
      dishes: [{ ...PUBLIC_DISH_EXAMPLE, updatedAt: '2026-09-03T14:12:00.000Z' }],
      adoptedCopyId: MENU_ID,
    },
  ],
};

export const CONSENT_REQUIRED_EXAMPLE = {
  code: 'CONSENT_REQUIRED',
  message: 'Send `{ "consent": true }`: nothing is copied without your explicit consent.',
};
