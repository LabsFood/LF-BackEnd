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
    sentLines: null,
    marksVersion: null,
    marksUpdatedAt: null,
    chefReplies: [],
    items,
    ...state,
  };
  const prisma = {
    booking: {
      findUnique: jest.fn(async () => ({
        id: 'b1',
        bookingMeals,
        chefProfile: { pantryStaples: state.pantryStaples ?? [] },
      })),
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
      findMany: jest.fn(async ({ where }: { where: { edited?: boolean } }) =>
        items.filter(
          (item) =>
            where.edited === undefined ||
            (item as { edited: boolean }).edited === where.edited,
        ),
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
            haveQty: null,
            toBuyQty: 6,
            chefReply: null,
            providedByChef: false,
          },
          {
            name: 'Citron',
            qty: 2,
            unit: 'pièce',
            edited: true,
            alreadyHave: false,
            comment: null,
            haveQty: null,
            toBuyQty: 2,
            chefReply: null,
            providedByChef: false,
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
      .mockResolvedValue({
        id: 'sl1',
        generatedAt: new Date(),
        version: 0,
        marksVersion: null,
        clientMarks: [],
        chefReplies: [],
        items: [],
      } as never);

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

    const sentGarlic = { ...garlic, edited: false };

    it('shows both sides the marks that answer the version sent last, and only those', async () => {
      const answered = {
        version: 2,
        sentAt: SENT,
        sentLines: [sentGarlic],
        clientMarks: [mark],
        marksVersion: 2,
        marksUpdatedAt: SENT,
      };
      const stale = { ...answered, marksVersion: 1 };

      const chef = await lists([], [garlicItem], answered).service.view('b1');
      const client = await lists([], [garlicItem], answered).service.view('b1', {
        forClient: true,
      });
      const old = await lists([], [garlicItem], stale).service.view('b1');

      expect(chef.groups[0].lines[0]).toMatchObject({ alreadyHave: true, toBuyQty: 0 });
      expect(chef).toMatchObject({ marksUpdatedAt: SENT, pendingChanges: false });
      expect(client.groups[0].lines[0]).toMatchObject({ alreadyHave: true });
      expect(client).toMatchObject({ version: 2, sentAt: SENT, marksUpdatedAt: SENT });
      expect(old.groups[0].lines[0]).toMatchObject({ alreadyHave: false });
      expect(old.marksUpdatedAt).toBeNull();
    });

    it('stores the final list with the quantities of the list, and when it came', async () => {
      const { service, prisma } = lists([], [garlicItem], {
        version: 1,
        sentAt: SENT,
        sentLines: [sentGarlic],
      });

      const stored = await service.submit(
        'b1',
        { version: 1, marks: [{ name: 'ail', unit: 'gousse', alreadyHave: true }] },
        DEADLINE,
      );

      expect(stored).toEqual({ version: 1, marks: 1 });
      expect(prisma.shoppingList.update).toHaveBeenCalledWith({
        where: { id: 'sl1' },
        data: {
          clientMarks: [{ ...mark, haveQty: null }],
          marksVersion: 1,
          marksUpdatedAt: expect.any(Date),
          finalReceivedAt: expect.any(Date),
        },
      });
    });

    it('checks a final list against the version sent, not the chef’s live lines', async () => {
      // The chef added parsley since, without sending it.
      const parsley = { name: 'Persil', qty: 1, unit: 'botte', aisle: 'fruits-legumes' };
      const { service } = lists(
        [],
        [garlicItem, { ...parsley, edited: true, removed: false }],
        {
          version: 1,
          sentAt: SENT,
          sentLines: [sentGarlic],
        },
      );

      await expect(
        service.submit(
          'b1',
          { version: 1, marks: [{ name: 'Persil', unit: 'botte', alreadyHave: true }] },
          DEADLINE,
        ),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_FAILED' } });
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

  describe('what the client reads (review before sending)', () => {
    const garlicItem = { ...garlic, quantity: '4 gousse', edited: false, removed: false };

    it('shows the client no line before the first send', async () => {
      const view = await lists([], [garlicItem]).service.view('b1', { forClient: true });

      expect(view).toMatchObject({ version: 0, groups: [], providedByChef: [] });
    });

    it('shows the client the version sent, not the corrections made since', async () => {
      const corrected = [
        garlicItem,
        { ...garlic, qty: 8, quantity: '8 gousse', edited: true, removed: false },
      ];
      const state = {
        version: 1,
        sentAt: new Date(),
        sentLines: [{ ...garlic, edited: false }],
      };

      const client = await lists([], corrected, state).service.view('b1', {
        forClient: true,
      });
      const chef = await lists([], corrected, state).service.view('b1');

      expect(client.groups[0].lines[0]).toMatchObject({ qty: 4, edited: false });
      expect(chef.groups[0].lines[0]).toMatchObject({ qty: 8, edited: true });
      expect((chef as { pendingChanges: boolean }).pendingChanges).toBe(true);
      expect((chef as { changesSinceSent: unknown }).changesSinceSent).toEqual({
        added: [],
        removed: [],
        changed: [
          {
            before: { ...garlic, edited: false },
            after: { ...garlic, qty: 8, edited: true },
          },
        ],
      });
    });

    it('sets the lines the batch cooker brings apart, without checkbox', async () => {
      const salt = { name: 'Sel', qty: 5, unit: 'g', aisle: 'epicerie', edited: false };
      const view = await lists([], [], {
        version: 1,
        sentLines: [
          { ...garlic, edited: false },
          { ...salt, providedByChef: true },
        ],
      }).service.view('b1', { forClient: true });

      expect(view.groups).toHaveLength(1);
      expect(view.groups[0].lines.map((l) => l.name)).toEqual(['Ail']);
      expect((view as { providedByChef: unknown }).providedByChef).toEqual([
        { ...salt, providedByChef: true },
      ]);
    });

    it('tells the chef nothing is pending before the first send', async () => {
      const view = await lists([], [garlicItem]).service.view('b1');

      expect(view).toMatchObject({ pendingChanges: false, changesSinceSent: null });
    });
  });

  describe('send: the snapshot', () => {
    const garlicItem = { ...garlic, quantity: '4 gousse', edited: false, removed: false };
    const salt = { name: 'Sel', qty: 5, unit: 'g', aisle: 'epicerie' };
    const saltItem = { ...salt, quantity: '5 g', edited: false, removed: false };

    it('writes the lines as sent with the new version, in the same lock', async () => {
      const { service, prisma } = lists([], [garlicItem]);

      await expect(service.send('b1')).resolves.toEqual({ version: 1 });

      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(prisma.shoppingList.update).toHaveBeenCalledWith({
        where: { id: 'sl1' },
        data: {
          version: 1,
          sentAt: expect.any(Date),
          sentLines: [{ ...garlic, edited: false }],
          clientMarks: [],
          marksVersion: null,
        },
      });
    });

    it('carries the marks of unchanged lines to the new version, and drops the others', async () => {
      const marks = [
        { name: 'Ail', unit: 'gousse', qty: 4, alreadyHave: true, comment: null },
        { name: 'Sel', unit: 'g', qty: 3, alreadyHave: true, comment: null },
      ];
      const { service, prisma } = lists([], [garlicItem, saltItem], {
        version: 1,
        sentLines: [
          { ...garlic, edited: false },
          { ...salt, qty: 3, edited: false },
        ],
        clientMarks: marks,
        marksVersion: 1,
      });

      await service.send('b1');

      expect(prisma.shoppingList.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            version: 2,
            clientMarks: [marks[0]],
            marksVersion: 2,
          }),
        }),
      );
    });
  });

  describe('ticks saved at once (PATCH …/marks)', () => {
    const SENT = new Date('2026-11-02T09:00:00.000Z');
    const DEADLINE = new Date(Date.now() + 24 * 3600 * 1000);
    const sent = { version: 1, sentAt: SENT, sentLines: [{ ...garlic, edited: false }] };
    const tick = { name: 'Ail', unit: 'gousse', alreadyHave: true };

    it('merges the tick into the marks of the version on screen', async () => {
      const { service, prisma } = lists([], [], sent);

      const saved = await service.saveMarks(
        'b1',
        { version: 1, marks: [tick] },
        DEADLINE,
      );

      expect(saved).toEqual({ version: 1, marks: 1, notify: true });
      expect(prisma.shoppingList.update).toHaveBeenCalledWith({
        where: { id: 'sl1' },
        data: {
          clientMarks: [{ ...tick, qty: 4, comment: null, haveQty: null }],
          marksVersion: 1,
          marksUpdatedAt: expect.any(Date),
        },
      });
    });

    it('removes a mark sent back empty', async () => {
      const { service, prisma } = lists([], [], {
        ...sent,
        clientMarks: [{ ...tick, qty: 4, comment: null }],
        marksVersion: 1,
      });

      await service.saveMarks(
        'b1',
        { version: 1, marks: [{ ...tick, alreadyHave: false }] },
        DEADLINE,
      );

      expect(prisma.shoppingList.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ clientMarks: [] }) }),
      );
    });

    it('rings the chef only after a quiet spell', async () => {
      const recent = lists([], [], {
        ...sent,
        marksUpdatedAt: new Date(Date.now() - 60_000),
      });
      const quiet = lists([], [], {
        ...sent,
        marksUpdatedAt: new Date(Date.now() - 16 * 60_000),
      });

      await expect(
        recent.service.saveMarks('b1', { version: 1, marks: [tick] }, DEADLINE),
      ).resolves.toMatchObject({ notify: false });
      await expect(
        quiet.service.saveMarks('b1', { version: 1, marks: [tick] }, DEADLINE),
      ).resolves.toMatchObject({ notify: true });
    });

    it.each([
      ['SHOPPING_LIST_NOT_SENT', { version: 0 }, 0, DEADLINE],
      ['SHOPPING_LIST_UPDATED', { ...sent, version: 2 }, 1, DEADLINE],
      ['SHOPPING_LIST_FROZEN', sent, 1, new Date(Date.now() - 1000)],
    ])('refuses with %s and stores nothing', async (code, state, version, deadline) => {
      const { service, prisma } = lists([], [], state);

      await expect(
        service.saveMarks('b1', { version, marks: [tick] }, deadline),
      ).rejects.toMatchObject({ response: { code } });
      expect(prisma.shoppingList.update).not.toHaveBeenCalled();
    });
  });

  describe('chef replies', () => {
    const NOW = Date.now();
    const sent = {
      version: 1,
      sentLines: [{ ...garlic, edited: false }],
      clientMarks: [
        { name: 'Ail', unit: 'gousse', qty: 4, alreadyHave: false, comment: 'Rose' },
      ],
      marksVersion: 1,
    };

    it('stores the reply with the comment it answers, and rings the client once', async () => {
      const { service, prisma } = lists([], [], sent);

      await expect(
        service.reply('b1', [{ name: 'Ail', unit: 'gousse', reply: 'OK' }]),
      ).resolves.toEqual({ replies: 1, notify: true });
      expect(prisma.shoppingList.update).toHaveBeenCalledWith({
        where: { id: 'sl1' },
        data: {
          chefReplies: [expect.objectContaining({ reply: 'OK', answersComment: 'Rose' })],
        },
      });

      const again = lists([], [], {
        ...sent,
        chefReplies: [
          {
            name: 'Ail',
            unit: 'gousse',
            reply: 'OK',
            answersComment: 'Rose',
            repliedAt: new Date(NOW - 60_000),
          },
        ],
      });
      await expect(
        again.service.reply('b1', [{ name: 'Ail', unit: 'gousse', reply: 'OK, rose' }]),
      ).resolves.toMatchObject({ notify: false });
    });
  });

  describe('« Fourni par le batch cooker »', () => {
    const dishes = [{ mealId: 'm1', portions: 4, recipeVersion: null, meal: meal('m1') }];

    it('marks a computed line from the pantry staples, accents and case aside', async () => {
      const { service, prisma } = lists(dishes, [], { pantryStaples: ['AIL'] });

      await service.regenerateForBooking('b1');

      expect(prisma.shoppingItem.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ name: 'Ail', providedByChef: true })],
      });
    });

    it('keeps the mark when an older front sends the line without the field', async () => {
      const brought = {
        ...garlic,
        quantity: '4 gousse',
        edited: false,
        removed: false,
        providedByChef: true,
      };
      const { service, prisma } = lists([], [brought], {});

      await service.correct('b1', [garlic]);

      // Same as computed, still brought: no correction to store.
      expect(prisma.shoppingItem.createMany).toHaveBeenCalledWith({ data: [] });
    });

    it('stores a line marked by hand as a correction, so it survives a recalculation', async () => {
      const garlicItem = {
        ...garlic,
        quantity: '4 gousse',
        edited: false,
        removed: false,
      };
      const { service, prisma } = lists([], [garlicItem], {});

      await service.correct('b1', [{ ...garlic, providedByChef: true }]);

      expect(prisma.shoppingItem.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ name: 'Ail', edited: true, providedByChef: true }),
        ],
      });
    });
  });

  describe('after a change of dishes (Recettes lot 4, LF-0283)', () => {
    const later = new Date(Date.now() + 86_400_000);
    // Not pinned yet: the first computation pins and keeps the version.
    const dishes = [{ mealId: 'm1', portions: 4, recipeVersion: null, meal: meal('m1') }];

    it('sends the recomputed list again when the client already had one', async () => {
      const garlicItem = {
        ...garlic,
        quantity: '4 gousse',
        edited: false,
        removed: false,
      };
      const { service, prisma } = lists(dishes, [garlicItem], {
        version: 1,
        sentAt: new Date(),
      });

      await expect(service.refreshAfterMenuChange('b1', later)).resolves.toBe(2);
      expect(prisma.shoppingList.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            version: 2,
            sentAt: expect.any(Date),
            sentLines: [expect.objectContaining({ name: 'Ail' })],
          }),
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
