import { ForbiddenException } from '@nestjs/common';

import { MealStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ChefDocumentsService } from '../chef-onboarding/services/chef-documents.service';
import { AuditService } from '../../common/audit/audit.service';
import { ChefContentService } from './chef-content.service';
import { DishesMailer } from './dishes.mailer';

/** Fixtures shared by the FLOW-02 service specs. Not a spec: never run on its own. */

export const CHEF = {
  id: 'chef-1',
  userId: 'user-1',
  isVerified: true,
  isActive: true,
  autoSuspendedAt: null,
  application: { workAuthorizationStatus: 'eu_citizen' },
};

export function dishRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dish-1',
    chefProfileId: CHEF.id,
    name: 'Poulet rôti aux herbes',
    country: 'FR',
    portions: 3,
    prepTime: 20,
    cookTime: 55,
    dietaryTags: [],
    customDiets: [],
    // No line yet: the chef's own `celery` is the whole computed list (Recettes §6.1).
    allergens: ['celery'],
    allergensNone: false,
    allergensVerifiedAt: null as Date | null,
    customAllergens: [],
    addedAllergens: ['celery'] as string[],
    conditionalAllergens: [] as string[],
    lockVersion: 0,
    category: null as string | null,
    description: null as string | null,
    imageUrl: null as string | null,
    ingredients: [] as unknown[],
    steps: [] as unknown[],
    equipment: [] as string[],
    declaredDiets: [] as string[],
    profiles: [] as string[],
    personalTags: [] as string[],
    seasonsOverride: [] as number[],
    classification: null as unknown,
    reheating: null as unknown,
    storage: null as unknown,
    recipeVersion: 1,
    versionPending: false,
    status: MealStatus.draft,
    publishedAt: null,
    ...UNMODERATED,
    ...overrides,
  };
}

/** An entry of the common ingredient list, as `ingredients/composition.ts` reads it. */
export function entryRow(overrides: { id: string } & Record<string, unknown>) {
  return {
    name: 'Tomate',
    aisle: 'fruits-legumes' as string | null,
    allergens: [] as string[],
    allergensNone: true,
    isBasic: false,
    diets: ['vegetarian', 'no-pork'],
    seasonMonths: [1, 2, 3],
    status: 'active',
    chefProfileId: null as string | null,
    mergedIntoId: null as string | null,
    ...overrides,
  };
}

/** The entries `readyDishRow`'s lines link, stamped as they are on those lines. */
export const READY_ENTRIES = [
  entryRow({ id: 'cat-ail', name: 'Ail' }),
  entryRow({
    id: 'cat-celeri',
    name: 'Céleri-rave',
    allergens: ['celery'],
    allergensNone: false,
  }),
];

/** `readyDishRow`'s recipe as the chef's screen sends it back, unchanged. */
export const READY_RECIPE = {
  ingredients: [
    { name: 'Ail', qty: 4, unit: 'clove', catalogIngredientId: 'cat-ail' },
    { name: 'Céleri-rave', qty: 300, unit: 'g', catalogIngredientId: 'cat-celeri' },
  ],
  steps: [{ text: 'Enfourner 55 min.', type: 'cuisson', durationMinutes: 55 }],
  storage: { method: 'fridge', days: 3, freezable: false },
  reheating: { modes: ['oven'], minutes: 15, note: 'Couvrir de papier alu.' },
};

/**
 * A line as a save stores it: every field written, stamped from its entry
 * (Recettes §5.2). A confirmation recomposing it finds nothing to change.
 */
export function stampedLine(overrides: Record<string, unknown> & { name: string }) {
  return {
    qty: 1,
    unit: 'piece',
    aisle: null as string | null,
    link: null,
    toVerify: false,
    fixedQuantity: false,
    catalogIngredientId: null as string | null,
    optional: false,
    precision: null,
    preparation: null,
    group: null,
    hiddenFromClient: false,
    rawText: null,
    allergens: [] as string[],
    incomplete: false,
    ...overrides,
  };
}

/**
 * A dish that passes the Recettes §4.11 check, at version 2 with nothing pending.
 * Its allergens are the ones its lines bring (§6.1), as a save computes them.
 */
export function readyDishRow(overrides: Record<string, unknown> = {}) {
  return dishRow({
    category: 'main',
    description: 'Poulet fermier rôti, thym et romarin.',
    imageUrl: 'https://photos.example.com/poulet.jpg',
    ingredients: [
      stampedLine({
        name: 'Ail',
        qty: 4,
        unit: 'clove',
        aisle: 'fruits-legumes',
        catalogIngredientId: 'cat-ail',
      }),
      stampedLine({
        name: 'Céleri-rave',
        qty: 300,
        unit: 'g',
        aisle: 'fruits-legumes',
        catalogIngredientId: 'cat-celeri',
        allergens: ['celery'],
      }),
    ],
    addedAllergens: [],
    allergens: ['celery'],
    allergensNone: false,
    conditionalAllergens: [],
    classification: { diets: ['no-pork', 'vegetarian'], seasonMonths: [1, 2, 3] },
    steps: [
      { order: 1, text: 'Enfourner 55 min.', type: 'cuisson', durationMinutes: 55 },
    ],
    storage: {
      method: 'fridge',
      days: 3,
      container: null,
      freezable: false,
      freezerMonths: null,
      thawing: null,
    },
    reheating: {
      modes: ['oven'],
      mode: 'oven',
      minutes: 15,
      note: 'Couvrir de papier alu.',
    },
    allergensVerifiedAt: new Date('2026-11-01T09:00:00.000Z'),
    recipeVersion: 2,
    ...overrides,
  });
}

/** Never reviewed, never taken down. */
const UNMODERATED = {
  reviewedAt: null,
  reviewPendingSince: null,
  reviewReason: null,
  moderationReason: null,
  moderationReasonCode: null,
  moderatedAt: null,
};

export function menuRow(
  overrides: Record<string, unknown> = {},
  dishes: ReturnType<typeof dishRow>[] = [dishRow()],
) {
  return {
    id: 'menu-1',
    chefProfileId: CHEF.id,
    title: 'Semaine méditerranéenne',
    pitch: null,
    period: 'week',
    status: MealStatus.draft,
    shoppingIncluded: false,
    publishedAt: null,
    ...UNMODERATED,
    dishes: dishes.map((meal, position) => ({
      menuId: 'menu-1',
      mealId: meal.id,
      position,
      meal,
    })),
    ...overrides,
  };
}

/** A row as the admin views read it: with its author and how much it is used. */
export function adminRow<T extends object>(row: T) {
  return {
    ...row,
    chefProfile: { id: CHEF.id, displayName: 'Marie Dupont' },
    _count: { menus: 2, bookingMeals: 1 },
  };
}

type WriteArgs = { where?: Record<string, unknown>; data: Record<string, unknown> };

/**
 * Chef services wired to an in-memory Prisma double. `chef` replaces the caller
 * (null: no chef profile); `dossier` sets the §3.3 publication gate.
 */
export function harness(options: { chef?: object | null; dossier?: string } = {}) {
  const meal = {
    findUnique: jest.fn(async (_args?: unknown): Promise<unknown> => dishRow()),
    findFirst: jest.fn(async (_args?: unknown): Promise<unknown> => null),
    findUniqueOrThrow: jest.fn(async () => adminRow(dishRow())),
    findMany: jest.fn(async (_args?: unknown): Promise<unknown[]> => []),
    create: jest.fn(async ({ data }: WriteArgs) => dishRow(data)),
    update: jest.fn(async ({ data }: WriteArgs) => dishRow(data)),
    updateMany: jest.fn(async (_args?: unknown) => ({ count: 0 })),
    delete: jest.fn(async () => undefined),
    count: jest.fn(async (_args?: unknown) => 0),
  };
  const menu = {
    findFirst: jest.fn(async (_args?: unknown): Promise<unknown> => null),
    findUniqueOrThrow: jest.fn(async () => adminRow(menuRow({}, [adminRow(dishRow())]))),
    updateMany: jest.fn(async (_args?: unknown) => ({ count: 0 })),
    findUnique: jest.fn(async (): Promise<unknown> => menuRow()),
    findMany: jest.fn(async (): Promise<unknown[]> => []),
    // `dishes` in the write is Prisma's nested create, not the rows: keep the fixture's.
    create: jest.fn(async ({ data: { dishes: _nested, ...data } }: WriteArgs) =>
      menuRow(data),
    ),
    update: jest.fn(async ({ data }: WriteArgs) => menuRow(data)),
    delete: jest.fn(async () => undefined),
    count: jest.fn(async (_args?: unknown) => 0),
  };
  const menuDish = {
    deleteMany: jest.fn(async () => ({ count: 0 })),
    createMany: jest.fn(async () => ({ count: 0 })),
    count: jest.fn(async () => 0),
    findMany: jest.fn(async (_args?: unknown): Promise<unknown[]> => []),
  };
  const chefShowcaseWeek = {
    upsert: jest.fn(async (_args: Record<string, unknown>) => ({})),
    findMany: jest.fn(async (): Promise<unknown[]> => []),
  };
  const chefProfile = {
    findFirst: jest.fn(async () => (options.chef === undefined ? CHEF : options.chef)),
    findUnique: jest.fn(async (): Promise<unknown> => ({ id: 'chef-2' })),
  };
  const platformSetting = {
    findUnique: jest.fn(async (_args?: unknown): Promise<unknown> => null),
  };
  const catalogIngredient = {
    count: jest.fn(async (_args?: unknown) => 0),
    findMany: jest.fn(async (_args?: unknown): Promise<unknown[]> => []),
  };
  const mealRecipeVersion = {
    findUnique: jest.fn(async (_args?: unknown): Promise<unknown> => null),
    create: jest.fn(async ({ data }: WriteArgs) => data),
  };
  const client = {
    meal,
    menu,
    menuDish,
    chefShowcaseWeek,
    chefProfile,
    platformSetting,
    mealRecipeVersion,
    catalogIngredient,
  };
  const $transaction = jest.fn(async (work: unknown) =>
    typeof work === 'function' ? work(client) : Promise.all(work as Promise<unknown>[]),
  );
  const prisma = { ...client, $transaction } as unknown as PrismaService;
  const documents = {
    latestPerType: jest.fn(async () => new Map()),
    answersOf: jest.fn(() => ({})),
    deriveStatus: jest.fn(() => options.dossier ?? 'validated'),
  } as unknown as ChefDocumentsService;
  const access = new ChefContentService(prisma, documents);
  const audit = {
    record: jest.fn(async (_entry: Record<string, unknown>) => undefined),
    failed: jest.fn(async () => undefined),
  } as unknown as AuditService & { record: jest.Mock };
  const mailer = {
    sourceChanged: jest.fn(async () => ({ sent: true })),
    contentSuspended: jest.fn(async () => ({ sent: true })),
  } as unknown as DishesMailer & {
    sourceChanged: jest.Mock;
    contentSuspended: jest.Mock;
  };
  return { ...client, $transaction, access, prisma, audit, mailer };
}

/**
 * `catalogIngredient.findMany` answering from `entries` by id, as the database
 * would: the access check and the stamping both read the list this way.
 */
export function withEntries(
  h: ReturnType<typeof harness>,
  entries: ReturnType<typeof entryRow>[],
) {
  h.catalogIngredient.findMany.mockImplementation(async (args?: unknown) => {
    const { in: ids } = (args as { where: { id: { in: string[] } } }).where.id;
    return entries.filter((entry) => ids.includes(entry.id));
  });
}

export const codeOf = (error: unknown) =>
  (error as ForbiddenException).getResponse() as {
    code?: string;
    problems?: unknown;
  };
