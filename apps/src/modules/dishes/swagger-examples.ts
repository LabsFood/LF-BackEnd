/**
 * Response examples for the FLOW-02 routes in Swagger. They copy the shapes the
 * views in `dishes.views.ts` return: change them together.
 */

export const DISH_ID = '5b1f3c2e-8a44-4d0e-9f21-3c6a7e9b0d12';

/**
 * A recipe line as a save stores and returns it (Recettes §5.2): every field written,
 * stamped from the linked ingredient (`aisle`, `allergens`, `incomplete`).
 */
const LINE = {
  link: null,
  toVerify: false,
  fixedQuantity: false,
  optional: false,
  precision: null,
  preparation: null,
  group: null,
  hiddenFromClient: false,
  rawText: null,
  allergens: [] as string[],
  incomplete: false,
};

export const RECIPE_EXAMPLE = {
  ingredients: [
    {
      ...LINE,
      name: 'Poulet fermier entier',
      qty: 1.4,
      unit: 'kg',
      aisle: 'boucherie',
      precision: 'fermier',
      catalogIngredientId: '0d7c1c7a-3f5b-4d8e-9a1c-2b4e6f8a0c01',
    },
    {
      ...LINE,
      name: 'Pommes de terre grenaille',
      qty: 800,
      unit: 'g',
      aisle: 'fruits-legumes',
      catalogIngredientId: '0d7c1c7a-3f5b-4d8e-9a1c-2b4e6f8a0c02',
    },
    {
      ...LINE,
      name: 'Céleri-rave',
      qty: 300,
      unit: 'g',
      aisle: 'fruits-legumes',
      catalogIngredientId: '0d7c1c7a-3f5b-4d8e-9a1c-2b4e6f8a0c03',
      allergens: ['celery'],
    },
    {
      ...LINE,
      name: 'Ail',
      qty: 4,
      unit: 'clove',
      aisle: 'fruits-legumes',
      catalogIngredientId: '0d7c1c7a-3f5b-4d8e-9a1c-2b4e6f8a0c04',
    },
    {
      ...LINE,
      name: 'Sel',
      qty: null,
      unit: 'to_taste',
      aisle: 'epices',
      catalogIngredientId: '0d7c1c7a-3f5b-4d8e-9a1c-2b4e6f8a0c05',
      hiddenFromClient: true,
    },
  ],
  steps: [
    {
      order: 1,
      text: 'Préchauffer le four à 200 °C.',
      type: 'preparation',
      durationMinutes: 10,
    },
    {
      order: 2,
      text: "Glisser le beurre, l'ail écrasé et les herbes sous la peau du poulet.",
      type: 'preparation',
      durationMinutes: 10,
    },
    {
      order: 3,
      text: 'Enfourner 55 min en arrosant deux fois avec le jus.',
      type: 'cuisson',
      durationMinutes: 55,
    },
  ],
  reheating: {
    modes: ['oven'],
    mode: 'oven',
    temperature: 160,
    minutes: 15,
    note: 'Couvrir.',
    container: null,
  },
  storage: {
    method: 'fridge',
    days: 3,
    container: 'Boîte hermétique',
    freezable: true,
    freezerMonths: 3,
    thawing: 'Une nuit au réfrigérateur.',
  },
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
  difficulty: 'easy',
  diets: ['lactose-free'],
  customDiets: [],
  allergens: ['celery'],
  allergensNone: false,
  conditionalAllergens: [],
  customAllergens: ['sarrasin'],
};

/** The public fields plus the times and calories: chef and admin routes. */
export const DISH_SUMMARY_EXAMPLE = {
  ...PUBLIC_DISH_EXAMPLE,
  prepMinutes: 20,
  cookMinutes: 55,
  calories: 640,
};

/** `GET /me/dishes/{id}` → 200. */
export const DISH_EXAMPLE = {
  ...DISH_SUMMARY_EXAMPLE,
  recipe: RECIPE_EXAMPLE,
  addedAllergens: [],
  allergenSources: { celery: ['Céleri-rave'] },
  lockVersion: 4,
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
  code: 'RECIPE_NOT_READY',
  message: 'This recipe is not ready to publish.',
  problems: [
    {
      code: 'STEP_TYPE_MISSING',
      field: 'recipe.steps[0]',
      message: 'Say what this step is: preparation, cooking, cooling or packing.',
    },
    {
      code: 'ALLERGENS_UNVERIFIED',
      field: 'allergens',
      message: 'Confirm the allergens: the ingredients changed since they were verified.',
    },
  ],
};

/** `PATCH /me/dishes/{id}` with an outdated `lockVersion` → 409. */
export const RECIPE_CONFLICT_EXAMPLE = {
  code: 'RECIPE_CONFLICT',
  message: 'The recipe was changed since you opened it.',
  lockVersion: 5,
};

/** `POST` or `PATCH /me/dishes` with the same ingredient on lines 0 and 2 → 422. */
export const DUPLICATE_INGREDIENT_LINE_EXAMPLE = {
  code: 'DUPLICATE_INGREDIENT_LINE',
  message: 'The same ingredient appears on several lines.',
  lines: [[0, 2]],
};

/** `POST /me/dishes/{id}/allergens/confirm` with line 1 not linked → 422. */
export const INGREDIENT_NOT_LINKED_EXAMPLE = {
  code: 'INGREDIENT_NOT_LINKED',
  message: 'Some ingredients are not linked to the common list.',
  lines: [1],
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
            code: 'ALLERGENS_UNVERIFIED',
            field: 'allergens',
            message:
              'Confirm the allergens: the ingredients changed since they were verified.',
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
      ...DISH_SUMMARY_EXAMPLE,
      id: 'd3eebc99-9c0b-4ef8-bb6d-6bb9bd380a44',
      name: 'Poulet yassa',
      country: 'SN',
      updatedAt: '2026-09-03T14:12:00.000Z',
      isFeatured: true,
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
      dishes: [{ ...DISH_SUMMARY_EXAMPLE, updatedAt: '2026-09-03T14:12:00.000Z' }],
      adoptedCopyId: MENU_ID,
    },
  ],
};

export const CONSENT_REQUIRED_EXAMPLE = {
  code: 'CONSENT_REQUIRED',
  message: 'Send `{ "consent": true }`: nothing is copied without your explicit consent.',
};
