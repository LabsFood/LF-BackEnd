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
    allergens: ['celery'],
    allergensNone: false,
    allergensVerifiedAt: null as Date | null,
    customAllergens: [],
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

/** A dish that passes the Recettes §4.11 check, at version 2 with nothing pending. */
export function readyDishRow(overrides: Record<string, unknown> = {}) {
  return dishRow({
    category: 'main',
    description: 'Poulet fermier rôti, thym et romarin.',
    imageUrl: 'https://photos.example.com/poulet.jpg',
    ingredients: [{ name: 'Ail', qty: 4, unit: 'gousse', aisle: 'fruits-legumes' }],
    steps: [
      { order: 1, text: 'Enfourner 55 min.', type: 'cuisson', durationMinutes: 55 },
    ],
    storage: { method: 'fridge', days: 3, container: null },
    reheating: { modes: ['oven'], mode: 'oven', minutes: 15 },
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
  const chefIngredient = {
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
    chefIngredient,
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

export const codeOf = (error: unknown) =>
  (error as ForbiddenException).getResponse() as {
    code?: string;
    problems?: unknown;
  };
