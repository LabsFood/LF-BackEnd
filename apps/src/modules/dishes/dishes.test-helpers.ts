import { ForbiddenException } from '@nestjs/common';

import { MealStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ChefDocumentsService } from '../chef-onboarding/services/chef-documents.service';
import { ChefContentService } from './chef-content.service';

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
    customAllergens: [],
    ingredients: [],
    steps: [],
    reheating: null,
    storage: null,
    status: MealStatus.draft,
    publishedAt: null,
    ...overrides,
  };
}

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
    dishes: dishes.map((meal, position) => ({
      menuId: 'menu-1',
      mealId: meal.id,
      position,
      meal,
    })),
    ...overrides,
  };
}

type WriteArgs = { where?: Record<string, unknown>; data: Record<string, unknown> };

/**
 * Chef services wired to an in-memory Prisma double. `chef` replaces the caller
 * (null: no chef profile); `dossier` sets the §3.3 publication gate.
 */
export function harness(options: { chef?: object | null; dossier?: string } = {}) {
  const meal = {
    findUnique: jest.fn(async () => dishRow()),
    findMany: jest.fn(async (): Promise<unknown[]> => []),
    create: jest.fn(async ({ data }: WriteArgs) => dishRow(data)),
    update: jest.fn(async ({ data }: WriteArgs) => dishRow(data)),
    updateMany: jest.fn(async () => ({ count: 0 })),
    delete: jest.fn(async () => undefined),
  };
  const menu = {
    findUnique: jest.fn(async (): Promise<unknown> => menuRow()),
    findMany: jest.fn(async (): Promise<unknown[]> => []),
    // `dishes` in the write is Prisma's nested create, not the rows: keep the fixture's.
    create: jest.fn(async ({ data: { dishes: _nested, ...data } }: WriteArgs) =>
      menuRow(data),
    ),
    update: jest.fn(async ({ data }: WriteArgs) => menuRow(data)),
    delete: jest.fn(async () => undefined),
    count: jest.fn(async () => 0),
  };
  const menuDish = {
    deleteMany: jest.fn(async () => ({ count: 0 })),
    createMany: jest.fn(async () => ({ count: 0 })),
  };
  const chefShowcaseWeek = {
    upsert: jest.fn(async (_args: Record<string, unknown>) => ({})),
    findMany: jest.fn(async (): Promise<unknown[]> => []),
  };
  const chefProfile = {
    findFirst: jest.fn(async () => (options.chef === undefined ? CHEF : options.chef)),
  };
  const client = { meal, menu, menuDish, chefShowcaseWeek, chefProfile };
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
  return { ...client, $transaction, access, prisma };
}

export const codeOf = (error: unknown) =>
  (error as ForbiddenException).getResponse() as {
    code?: string;
    problems?: unknown;
  };
