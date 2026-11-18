import { PrismaService } from '../../prisma/prisma.service';
import { ShoppingListsService } from './shopping-lists.service';

const garlic = { name: 'Ail', qty: 4, unit: 'gousse', aisle: 'fruits-legumes' };

/** A meal as stored: a recipe for `portions` portions at `recipeVersion`. */
const meal = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  portions: 4,
  recipeVersion: 3,
  allergens: ['celery'],
  ingredients: [garlic],
  steps: ['Éplucher'],
  reheating: null,
  storage: null,
  ...overrides,
});

function lists(
  bookingMeals: object[],
  items: object[] = [],
  state: Record<string, unknown> = {},
) {
  const kept = new Map<string, object>();
  const row = {
    id: 'sl1',
    generatedAt: new Date('2026-09-20'),
    version: 0,
    sentAt: null,
    finalReceivedAt: null,
    clientMarks: [],
    items,
    ...state,
  };
  const prisma = {
    booking: {
      findUnique: jest.fn(async () => ({ id: 'b1', bookingMeals })),
    },
    mealRecipeVersion: {
      upsert: jest.fn((args: { create: { mealId: string; version: number } }) => {
        kept.set(`${args.create.mealId}:${args.create.version}`, args.create);
        return args;
      }),
      findMany: jest.fn(async () => [...kept.values()]),
    },
    bookingMeal: { update: jest.fn((args: unknown) => args) },
    // No saved aisle list: the defaults, in store order.
    platformSetting: { findUnique: jest.fn(async () => null) },
    shoppingList: {
      createMany: jest.fn(async () => ({ count: 0 })),
      update: jest.fn(async () => ({})),
      findUnique: jest.fn(async () => row),
      findUniqueOrThrow: jest.fn(async () => row),
    },
    shoppingItem: {
      findMany: jest.fn(async () =>
        items.filter((item) => !(item as { edited: boolean }).edited),
      ),
      deleteMany: jest.fn(async (args: unknown) => args),
      createMany: jest.fn(async (args: unknown) => args),
    },
    $queryRaw: jest.fn(async () => [{ id: 'sl1' }]),
    $transaction: jest.fn(async (work: unknown): Promise<unknown> =>
      typeof work === 'function' ? work(prisma) : work,
    ),
  };
  return {
    prisma,
    kept,
    service: new ShoppingListsService(prisma as unknown as PrismaService),
  };
}

describe('ShoppingListsService (FLOW-02 §7)', () => {
  it('pins each unpinned booked dish to its current recipe version, keeping its content', async () => {
    const { prisma, service, kept } = lists([
      { mealId: 'm1', portions: 4, recipeVersion: null, meal: meal('m1') },
      { mealId: 'm2', portions: 4, recipeVersion: 1, meal: meal('m2') },
    ]);
    // m2 was pinned earlier: its version 1 is already kept.
    kept.set('m2:1', { mealId: 'm2', version: 1 });

    await service.pinRecipes('b1');

    expect(prisma.mealRecipeVersion.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.mealRecipeVersion.upsert.mock.calls[0][0]).toMatchObject({
      where: { mealId_version: { mealId: 'm1', version: 3 } },
      create: { mealId: 'm1', version: 3, ingredients: [garlic] },
      update: {},
    });
    // Recettes lot 3 (LF-0268): the allergens of that moment are kept with the version.
    expect(prisma.bookingMeal.update).toHaveBeenCalledWith({
      where: { bookingId_mealId: { bookingId: 'b1', mealId: 'm1' } },
      data: {
        recipeVersion: 3,
        allergensSnapshot: ['celery'],
        pinnedAt: expect.any(Date),
      },
    });
  });

  it('pins inside the transaction it is given, so a menu write and its pin land together', async () => {
    const { prisma, service } = lists([
      { mealId: 'm1', portions: 4, recipeVersion: null, meal: meal('m1') },
    ]);

    await service.pinRecipes('b1', { db: prisma as never });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.bookingMeal.update).toHaveBeenCalledTimes(1);
  });

  it('moves every dish to its current version on a re-pin', async () => {
    const { prisma, service } = lists([
      { mealId: 'm2', portions: 4, recipeVersion: 1, meal: meal('m2') },
    ]);

    await service.pinRecipes('b1', { repin: true });

    expect(prisma.bookingMeal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          recipeVersion: 3,
          allergensSnapshot: ['celery'],
          pinnedAt: expect.any(Date),
        },
      }),
    );
  });

  it('scales to the portions booked and adds up the same ingredient', async () => {
    const { prisma, service } = lists([
      { mealId: 'm1', portions: 8, recipeVersion: null, meal: meal('m1') },
      {
        mealId: 'm2',
        portions: 2,
        recipeVersion: null,
        meal: meal('m2', { portions: 2, ingredients: [{ ...garlic, qty: 1 }] }),
      },
    ]);

    await service.regenerateForBooking('b1');

    expect(prisma.shoppingItem.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ name: 'Ail', qty: 9, quantity: '9 gousse' })],
    });
    // Only the computed lines are replaced: corrections stay.
    expect(prisma.shoppingItem.deleteMany).toHaveBeenCalledWith({
      where: { shoppingListId: 'sl1', edited: false },
    });
    // Under a lock on the booking's list row, so two recalculations cannot interleave.
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it('keeps a to_taste line in the list without quantity, merged across recipes (Recettes §4.12)', async () => {
    const salt = { name: 'Sel', unit: 'to_taste', aisle: 'epices' };
    const { prisma, service } = lists([
      {
        mealId: 'm1',
        portions: 4,
        recipeVersion: null,
        meal: meal('m1', { ingredients: [garlic, salt] }),
      },
      {
        mealId: 'm2',
        portions: 2,
        recipeVersion: null,
        meal: meal('m2', { portions: 2, ingredients: [{ ...salt, qty: null }] }),
      },
    ]);

    await service.regenerateForBooking('b1');

    const [[{ data }]] = prisma.shoppingItem.createMany.mock.calls as unknown as [
      [{ data: { name: string }[] }],
    ];
    expect(data.filter((item) => item.name === 'Sel')).toEqual([
      expect.objectContaining({
        name: 'Sel',
        qty: 0,
        unit: 'to_taste',
        quantity: 'selon le goût',
      }),
    ]);
  });

  it('lists the aisles in store order, unknown ones last (Recettes §5.4)', async () => {
    const item = (name: string, aisle: string) => ({
      name,
      qty: 1,
      unit: 'g',
      aisle,
      quantity: '1 g',
      edited: false,
      removed: false,
    });
    const { service } = lists(
      [],
      [
        item('Riz', 'epicerie-salee'),
        item('Truc', 'Rayon libre'),
        item('Ail', 'fruits-legumes'),
      ],
    );

    const { groups } = await service.view('b1');

    expect(groups.map((g) => g.aisle)).toEqual([
      'fruits-legumes',
      'epicerie-salee',
      'Rayon libre',
    ]);
  });

  it('shows corrections over the computed lines, grouped by aisle', async () => {
    const { service } = lists(
      [],
      [
        { ...garlic, quantity: '4 gousse', edited: false, removed: false },
        { ...garlic, qty: 6, quantity: '6 gousse', edited: true, removed: false },
        {
          name: 'Citron',
          qty: 2,
          unit: 'pièce',
          aisle: 'fruits-legumes',
          quantity: '2 pièce',
          edited: true,
          removed: false,
        },
      ],
    );

    const { groups } = await service.view('b1');

    expect(groups).toEqual([
      {
        aisle: 'fruits-legumes',
        lines: [
          {
            name: 'Ail',
            qty: 6,
            unit: 'gousse',
            edited: true,
            alreadyHave: false,
            comment: null,
          },
          {
            name: 'Citron',
            qty: 2,
            unit: 'pièce',
            edited: true,
            alreadyHave: false,
            comment: null,
          },
        ],
      },
    ]);
  });

  it('computes the list the first time it is asked for', async () => {
    const { prisma, service } = lists([
      { mealId: 'm1', portions: 4, recipeVersion: null, meal: meal('m1') },
    ]);
    prisma.shoppingList.findUnique
      .mockResolvedValueOnce(null as never)
      .mockResolvedValue({ id: 'sl1', generatedAt: new Date(), items: [] } as never);

    await service.view('b1');

    expect(prisma.shoppingItem.createMany).toHaveBeenCalled();
  });

  it('drops every correction on a reset, and recomputes', async () => {
    const { prisma, service } = lists([
      { mealId: 'm1', portions: 4, recipeVersion: 3, meal: meal('m1') },
    ]);
    prisma.mealRecipeVersion.findMany.mockResolvedValue([
      { mealId: 'm1', version: 3, portions: 4, ingredients: [garlic] },
    ] as never);

    await service.reset('b1');

    expect(prisma.shoppingItem.deleteMany).toHaveBeenCalledWith({
      where: { shoppingListId: 'sl1', edited: true },
    });
    expect(prisma.shoppingItem.deleteMany).toHaveBeenCalledWith({
      where: { shoppingListId: 'sl1', edited: false },
    });
  });

  it('refuses a list naming the same ingredient twice in the same unit', async () => {
    const { service } = lists([], []);
    await expect(
      service.correct('b1', [garlic, { ...garlic, name: 'ail', qty: 1 }]),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_FAILED' } });
  });

  it('stores what the chef changed as corrections, and nothing for unchanged lines', async () => {
    const { prisma, service } = lists(
      [],
      [{ ...garlic, quantity: '4 gousse', edited: false, removed: false }],
    );

    await service.correct('b1', [garlic, { ...garlic, name: 'Échalote', qty: 2 }]);

    expect(prisma.shoppingItem.deleteMany).toHaveBeenCalledWith({
      where: { shoppingListId: 'sl1', edited: true },
    });
    const [[{ data }]] = prisma.shoppingItem.createMany.mock.calls as unknown as [
      [{ data: { name: string; edited: boolean }[] }],
    ];
    expect(data.map((line) => line.name)).toEqual(['Échalote']);
  });

  describe('the client answer (Recettes §10.7)', () => {
    const SENT = new Date('2026-11-02T09:00:00.000Z');
    const DEADLINE = new Date(Date.now() + 24 * 3600 * 1000);
    const garlicItem = { ...garlic, quantity: '4 gousse', edited: false, removed: false };
    const mark = {
      name: 'Ail',
      unit: 'gousse',
      qty: 4,
      alreadyHave: true,
      comment: null,
    };

    it('shows the chef an answer only when it answers the list sent last', async () => {
      const older = {
        version: 2,
        sentAt: SENT,
        finalReceivedAt: new Date('2026-11-01'),
        clientMarks: [mark],
      };

      const chef = await lists([], [garlicItem], older).service.view('b1');
      const client = await lists([], [garlicItem], older).service.view('b1', {
        forClient: true,
      });

      expect(chef.groups[0].lines[0]).toMatchObject({ alreadyHave: false });
      expect(client.groups[0].lines[0]).toMatchObject({ alreadyHave: true });
      expect(client).toMatchObject({ version: 2, sentAt: SENT });
    });

    it('stores the final list with the quantities of the list, and when it came', async () => {
      const { service, prisma } = lists([], [garlicItem], { version: 1, sentAt: SENT });

      const stored = await service.submit(
        'b1',
        { version: 1, marks: [{ name: 'ail', unit: 'gousse', alreadyHave: true }] },
        DEADLINE,
      );

      expect(stored).toEqual({ version: 1, marks: 1 });
      expect(prisma.shoppingList.update).toHaveBeenCalledWith({
        where: { id: 'sl1' },
        data: { clientMarks: [mark], finalReceivedAt: expect.any(Date) },
      });
    });

    it('stores nothing when the chef sent a newer list since', async () => {
      const { service, prisma } = lists([], [garlicItem], { version: 2, sentAt: SENT });

      await expect(
        service.submit('b1', { version: 1, marks: [] }, DEADLINE),
      ).rejects.toMatchObject({
        response: { code: 'SHOPPING_LIST_UPDATED', version: 2 },
      });
      expect(prisma.shoppingList.update).not.toHaveBeenCalled();
    });
  });

  describe('after a change of dishes (Recettes lot 4, LF-0283)', () => {
    const later = new Date(Date.now() + 86_400_000);
    // Not pinned yet: the first computation pins and keeps the version.
    const dishes = [{ mealId: 'm1', portions: 4, recipeVersion: null, meal: meal('m1') }];

    it('sends the recomputed list again when the client already had one', async () => {
      const { prisma, service } = lists(dishes, [], { version: 1, sentAt: new Date() });
      prisma.shoppingList.update.mockResolvedValue({ version: 2 } as never);

      await expect(service.refreshAfterMenuChange('b1', later)).resolves.toBe(2);
      expect(prisma.shoppingList.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { version: { increment: 1 }, sentAt: expect.any(Date) },
        }),
      );
    });

    it('only recomputes a list never sent, or past the deadline', async () => {
      const never = lists(dishes);
      await expect(never.service.refreshAfterMenuChange('b1', later)).resolves.toBeNull();

      const frozen = lists(dishes, [], { version: 1, sentAt: new Date() });
      await expect(
        frozen.service.refreshAfterMenuChange('b1', new Date(Date.now() - 1000)),
      ).resolves.toBeNull();
      expect(frozen.prisma.shoppingList.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sentAt: expect.any(Date) }),
        }),
      );
    });
  });
});
