import { ConflictException, NotFoundException } from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { BookingStatus, UserRole } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
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
  shoppingByClient: false,
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
      // By the caller's user id (who is this?) or by the booking's chef id (who to tell).
      findUnique: jest.fn(async ({ where }: { where: { id?: string } }) =>
        where.id === 'chef-1'
          ? { id: 'chef-1', userId: 'chef-user' }
          : as === 'chef'
            ? { id: 'chef-1' }
            : null,
      ),
    },
  };
  const LIST = {
    generatedAt: new Date(),
    version: 0,
    sentAt: null,
    finalReceivedAt: null,
    groups: [],
  };
  const lists = {
    pinRecipes: jest.fn(async () => [PINNED]),
    regenerateForBooking: jest.fn(async () => ({})),
    view: jest.fn(async () => LIST),
    correct: jest.fn(async () => LIST),
    reset: jest.fn(async () => LIST),
    send: jest.fn(async () => ({ version: 1 })),
    submit: jest.fn(async () => ({ version: 1, marks: 1 })),
  };
  const audit = { record: jest.fn(async () => undefined) };
  const notifications = { notify: jest.fn(async () => ({})) };
  const service = new MissionsService(
    prisma as unknown as PrismaService,
    { findByClerkId: jest.fn(async () => user) } as unknown as UsersService,
    lists as unknown as ShoppingListsService,
    audit as unknown as AuditService,
    notifications as unknown as NotificationsService,
  );
  return { service, prisma, lists, audit, notifications };
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

  it('rounds each line by its unit (Recettes §4.12)', async () => {
    const { service, lists } = missions('chef');
    lists.pinRecipes.mockResolvedValue([
      {
        ...PINNED,
        recipe: {
          ...PINNED.recipe,
          ingredients: [
            { name: 'Ail', qty: 1, unit: 'clove', aisle: 'fruits-legumes' },
            { name: 'Sel', qty: 2.5, unit: 'g', aisle: 'epices' },
          ],
        },
      },
    ]);

    // 3 portions -> 4: 1.33 cloves go up to 2, 3.33 g keeps one decimal.
    const sheet = await service.recipeSheet('clerk', 'b1', 'dish-1', 4);

    expect(sheet.recipe.ingredients).toEqual([
      expect.objectContaining({ name: 'Ail', qty: 2 }),
      expect.objectContaining({ name: 'Sel', qty: 3.3 }),
    ]);
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

  describe('the list goes to the client and back (Recettes §10.7, case 1)', () => {
    const SUBJECT = { type: 'booking', id: 'b1' };
    const ANSWER = {
      version: 1,
      marks: [{ name: 'Ail', unit: 'gousse', alreadyHave: true }],
    };
    // Starts in an hour: noon the day before is already past.
    const tooLate = () => booking({ startsAt: new Date(Date.now() + 3600_000) });

    it('sends the list and tells the client, with the deadline and the status', async () => {
      const { service, lists, notifications } = missions('chef');

      const sent = await service.sendShoppingList('clerk', 'b1');

      expect(lists.send).toHaveBeenCalledWith('b1');
      expect(notifications.notify).toHaveBeenCalledWith(
        'client-1',
        'shopping_list.sent',
        SUBJECT,
      );
      expect(sent).toMatchObject({ shoppingByClient: false, status: 'preparing' });
      expect(sent.deadline).toBeInstanceOf(Date);
    });

    it('calls a second send an update', async () => {
      const { service, lists, notifications } = missions('chef');
      lists.send.mockResolvedValueOnce({ version: 2 });

      await service.sendShoppingList('clerk', 'b1');

      expect(notifications.notify).toHaveBeenCalledWith(
        'client-1',
        'shopping_list.updated',
        SUBJECT,
      );
    });

    it('still sends when the notification fails: the client sees the list anyway', async () => {
      const { service, notifications } = missions('chef');
      notifications.notify.mockRejectedValueOnce(new Error('down'));

      await expect(service.sendShoppingList('clerk', 'b1')).resolves.toMatchObject({
        missionId: 'b1',
      });
    });

    it('refuses to send after noon the day before', async () => {
      const { service, lists } = missions('chef', tooLate());

      const error = await service
        .sendShoppingList('clerk', 'b1')
        .catch((e: unknown) => e);

      expect(codeOf(error).code).toBe('SHOPPING_LIST_FROZEN');
      expect(lists.send).not.toHaveBeenCalled();
    });

    it('refuses both ways when the client does the shopping', async () => {
      const row = booking({ shoppingByClient: true });
      const chefSends = await missions('chef', row)
        .service.sendShoppingList('clerk', 'b1')
        .catch((e: unknown) => e);
      const clientAnswers = await missions('client', row)
        .service.submitShoppingList('clerk', 'b1', ANSWER)
        .catch((e: unknown) => e);

      expect(codeOf(chefSends).code).toBe('SHOPPING_BY_CLIENT');
      expect(codeOf(clientAnswers).code).toBe('SHOPPING_BY_CLIENT');
    });

    it('lets only the chef send and only the client answer', async () => {
      for (const who of ['admin', 'client'] as const) {
        const error = await missions(who)
          .service.sendShoppingList('clerk', 'b1')
          .catch((e: unknown) => e);
        expect(codeOf(error).code).toBe('CONTENT_NOT_OWNED');
      }
      for (const who of ['admin', 'chef'] as const) {
        const error = await missions(who)
          .service.submitShoppingList('clerk', 'b1', ANSWER)
          .catch((e: unknown) => e);
        expect(codeOf(error).code).toBe('CONTENT_NOT_OWNED');
      }
    });

    it('takes the final list against the deadline and tells the chef', async () => {
      const { service, lists, notifications } = missions('client');

      await service.submitShoppingList('clerk', 'b1', ANSWER);

      expect(lists.submit).toHaveBeenCalledWith('b1', ANSWER, expect.any(Date));
      expect(notifications.notify).toHaveBeenCalledWith(
        'chef-user',
        'shopping_list.final_received',
        SUBJECT,
      );
      expect(lists.view).toHaveBeenLastCalledWith('b1', { forClient: true });
    });

    it('shows the client their last answer, the others only an answer to the current list', async () => {
      for (const [who, forClient] of [
        ['client', true],
        ['chef', false],
        ['admin', false],
      ] as const) {
        const { service, lists } = missions(who);
        await service.shoppingList('clerk', 'b1');
        expect(lists.view).toHaveBeenCalledWith('b1', { forClient });
      }
    });

    it('shows the client only what counts once the list is frozen', async () => {
      const { service, lists } = missions('client', tooLate());

      await service.shoppingList('clerk', 'b1');

      expect(lists.view).toHaveBeenCalledWith('b1', { forClient: false });
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
