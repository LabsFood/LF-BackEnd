import { ConflictException, NotFoundException } from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { BookingStatus, UserRole } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ShoppingListsService } from '../shopping-lists/shopping-lists.service';
import { UsersService } from '../users/users.service';
import { codeOf } from './dishes.test-helpers';
import { MissionsService } from './missions.service';

const FUTURE = new Date(Date.now() + 7 * 24 * 3600 * 1000);

const booking = (overrides: Record<string, unknown> = {}) => ({
  id: 'b1',
  chefProfileId: 'chef-1',
  clientId: 'client-1',
  status: BookingStatus.confirmed,
  startsAt: FUTURE,
  persons: 3,
  bookingMeals: [{ mealId: 'dish-1', recipeVersion: 2 }],
  ...overrides,
});

const PINNED = {
  mealId: 'dish-1',
  portions: 3,
  meal: {
    id: 'dish-1',
    name: 'Poulet rôti',
    country: 'FR',
    category: 'main',
    dietaryTags: [],
    customDiets: [],
    allergens: ['celery'],
    allergensNone: false,
    customAllergens: [],
    recipeVersion: 3,
    chefProfileId: 'chef-1' as string | null,
  },
  recipe: {
    version: 2,
    portions: 3,
    ingredients: [{ name: 'Ail', qty: 3, unit: 'gousse', aisle: 'fruits-legumes' }],
    steps: ['Éplucher'],
    reheating: null,
    storage: null,
  },
};

/** `as`: who calls — the booking's chef, an admin, its client, or a stranger. */
function missions(as: 'chef' | 'admin' | 'client' | 'stranger', row = booking()) {
  const user = {
    id: as === 'client' ? 'client-1' : `${as}-user`,
    role: as === 'admin' ? UserRole.admin : UserRole.client,
  };
  const prisma = {
    booking: {
      findUnique: jest.fn(async () => row),
      findMany: jest.fn(async (): Promise<unknown[]> => []),
    },
    chefProfile: {
      findUnique: jest.fn(async () => (as === 'chef' ? { id: 'chef-1' } : null)),
    },
  };
  const lists = {
    pinRecipes: jest.fn(async () => [PINNED]),
    regenerateForBooking: jest.fn(async () => ({})),
    view: jest.fn(async () => ({ generatedAt: new Date(), groups: [] })),
    correct: jest.fn(async () => ({ generatedAt: new Date(), groups: [] })),
    reset: jest.fn(async () => ({ generatedAt: new Date(), groups: [] })),
  };
  const audit = { record: jest.fn(async () => undefined) };
  const service = new MissionsService(
    prisma as unknown as PrismaService,
    { findByClerkId: jest.fn(async () => user) } as unknown as UsersService,
    lists as unknown as ShoppingListsService,
    audit as unknown as AuditService,
  );
  return { service, prisma, lists, audit };
}

describe('MissionsService (FLOW-02 §7, §8)', () => {
  describe('who sees what', () => {
    it('hides the prestation from anyone but its chef, the admins and its client', async () => {
      await expect(
        missions('stranger').service.shoppingList('clerk', 'b1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      for (const who of ['chef', 'admin', 'client'] as const) {
        await expect(
          missions(who).service.shoppingList('clerk', 'b1'),
        ).resolves.toMatchObject({ missionId: 'b1', persons: 3 });
      }
    });

    it('lets only the chef change the shopping list', async () => {
      for (const who of ['admin', 'client'] as const) {
        const error = await missions(who)
          .service.resetShoppingList('clerk', 'b1')
          .catch((e: unknown) => e);
        expect(codeOf(error).code).toBe('CONTENT_NOT_OWNED');
      }
    });

    it('hands the fiche to the client only after the prestation', async () => {
      const early = await missions('client')
        .service.recipeSheet('clerk', 'b1', 'dish-1')
        .catch((e: unknown) => e);
      expect(codeOf(early).code).toBe('NOT_YET_AVAILABLE');

      const done = missions('client', booking({ status: BookingStatus.completed }));
      await expect(
        done.service.recipeSheet('clerk', 'b1', 'dish-1'),
      ).resolves.toBeDefined();
    });
  });

  it('shows the recipe cooked, scaled, and says a newer version exists', async () => {
    const sheet = await missions('chef').service.recipeSheet('clerk', 'b1', 'dish-1', 6);

    expect(sheet.portions).toBe(6);
    expect(sheet.recipe.ingredients).toEqual([
      { name: 'Ail', qty: 6, unit: 'gousse', aisle: 'fruits-legumes' },
    ]);
    expect(sheet.version).toEqual({ pinned: 2, current: 3, newerAvailable: true });
  });

  it('never hands a chef another chef’s recipe through a prestation', async () => {
    const { service, lists } = missions('chef');
    lists.pinRecipes.mockResolvedValue([
      { ...PINNED, meal: { ...PINNED.meal, chefProfileId: 'chef-2' } },
    ] as never);

    await expect(service.recipeSheet('clerk', 'b1', 'dish-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('answers 404 for a dish that is not part of the prestation', async () => {
    await expect(
      missions('chef').service.recipeSheet('clerk', 'b1', 'other-dish'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('re-pinning', () => {
    it('moves to the current recipes before the prestation, recorded', async () => {
      const { service, lists, audit } = missions('chef');

      await service.repin('clerk', 'b1');

      expect(lists.pinRecipes).toHaveBeenCalledWith('b1', { repin: true });
      expect(lists.regenerateForBooking).toHaveBeenCalledWith('b1');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'recipes.repinned', subjectId: 'b1' }),
      );
    });

    it('is refused once the prestation has started', async () => {
      const started = missions(
        'chef',
        booking({ startsAt: new Date(Date.now() - 60_000) }),
      );
      await expect(started.service.repin('clerk', 'b1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  it('colours a country only for delivered prestations, keyed both ways', async () => {
    const { service, prisma } = missions('client');
    prisma.booking.findMany.mockResolvedValue([
      {
        startsAt: new Date('2026-05-24T09:00:00Z'),
        bookingMeals: [
          { meal: { name: 'Poulet rôti', country: 'FR' } },
          { meal: { name: 'Mafé', country: 'Sénégal' } },
        ],
      },
    ]);

    const map = await service.culinaryMap('clerk');

    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: 'client-1', status: BookingStatus.completed },
      }),
    );
    expect(map).toEqual({
      total: 195,
      explored: [
        {
          code: 'FR',
          iso3166Numeric: '250',
          name: 'France',
          firstTastedAt: new Date('2026-05-24T09:00:00Z'),
          dishes: ['Poulet rôti'],
        },
      ],
    });
  });
});
