import { PrismaService } from '../../prisma/prisma.service';
import { ShoppingListsService } from './shopping-lists.service';

const garlic = { name: 'Ail', qty: 4, unit: 'gousse', aisle: 'fruits-legumes' };

/** A meal as stored: a recipe for `portions` portions at `recipeVersion`. */
const meal = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  portions: 4,
  recipeVersion: 3,
  ingredients: [garlic],
  steps: ['Éplucher'],
  reheating: null,
  storage: null,
  ...overrides,
});

function lists(bookingMeals: object[], items: object[] = []) {
  const kept = new Map<string, object>();
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
    shoppingList: {
      createMany: jest.fn(async () => ({ count: 0 })),
      update: jest.fn(async () => ({})),
      findUnique: jest.fn(async () => ({
        id: 'sl1',
        generatedAt: new Date('2026-09-20'),
        items,
      })),
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
    expect(prisma.bookingMeal.update).toHaveBeenCalledWith({
      where: { bookingId_mealId: { bookingId: 'b1', mealId: 'm1' } },
      data: { recipeVersion: 3 },
    });
  });

  it('moves every dish to its current version on a re-pin', async () => {
    const { prisma, service } = lists([
      { mealId: 'm2', portions: 4, recipeVersion: 1, meal: meal('m2') },
    ]);

    await service.pinRecipes('b1', { repin: true });

    expect(prisma.bookingMeal.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { recipeVersion: 3 } }),
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
          { name: 'Ail', qty: 6, unit: 'gousse', edited: true },
          { name: 'Citron', qty: 2, unit: 'pièce', edited: true },
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
});
