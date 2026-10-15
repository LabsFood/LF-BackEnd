import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';

import { MealStatus, Prisma } from '../../generated/prisma/client';
import { CHEF, codeOf, dishRow, harness, menuRow } from './dishes.test-helpers';
import { SuggestionsService } from './suggestions.service';

const service = (h: ReturnType<typeof harness>) =>
  new SuggestionsService(h.prisma, h.access, h.audit, h.mailer);

/** A published Lab's Food dish nobody owns or is offered: a suggestion. */
const suggestion = (overrides: Record<string, unknown> = {}) =>
  dishRow({
    id: 'sugg-1',
    chefProfileId: null,
    offeredToChefProfileId: null,
    createdByUserId: 'admin-1',
    status: MealStatus.published,
    updatedAt: new Date('2026-09-10T09:00:00Z'),
    ingredients: [{ name: 'Ail', qty: 2, unit: 'gousse', aisle: 'fruits-legumes' }],
    ...overrides,
  });

describe('SuggestionsService', () => {
  describe('adopt (§6)', () => {
    it('refuses without explicit consent', async () => {
      const h = harness();
      const error = await service(h)
        .adopt('clerk_1', 'sugg-1', false)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(codeOf(error).code).toBe('CONSENT_REQUIRED');
      expect(h.meal.create).not.toHaveBeenCalled();
    });

    it('copies a suggestion as the chef’s draft, with its lineage, and records consent', async () => {
      const h = harness();
      h.meal.findFirst.mockResolvedValue(suggestion());
      h.meal.findUnique.mockResolvedValue(null);

      const result = await service(h).adopt('clerk_1', 'sugg-1', true);

      expect(result.created).toBe(true);
      expect(h.meal.create.mock.calls[0][0].data).toMatchObject({
        chefProfileId: CHEF.id,
        createdByUserId: 'admin-1',
        sourceMealId: 'sugg-1',
        sourceVersion: new Date('2026-09-10T09:00:00Z'),
        status: MealStatus.draft,
        ingredients: [{ name: 'Ail', qty: 2, unit: 'gousse', aisle: 'fruits-legumes' }],
      });
      expect(h.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: 'chef',
          actorUserId: CHEF.userId,
          action: 'suggestion.adopted',
          subjectId: 'sugg-1',
          metadata: expect.objectContaining({ consent: true }),
        }),
      );
    });

    it('gives back the copy already made on a second adoption', async () => {
      const h = harness();
      h.meal.findFirst.mockResolvedValue(suggestion());
      h.meal.findUnique.mockResolvedValue(
        dishRow({ id: 'copy-1', sourceMealId: 'sugg-1' }),
      );

      const result = await service(h).adopt('clerk_1', 'sugg-1', true);

      expect(result).toMatchObject({ created: false, copy: { id: 'copy-1' } });
      expect(h.meal.create).not.toHaveBeenCalled();
      expect(h.audit.record).not.toHaveBeenCalled();
    });

    it('survives a double click: the losing request finds the winner’s copy', async () => {
      const h = harness();
      h.meal.findFirst.mockResolvedValue(suggestion());
      h.meal.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(dishRow({ id: 'copy-1' }));
      h.meal.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 't',
        }),
      );

      const result = await service(h).adopt('clerk_1', 'sugg-1', true);

      expect(result).toMatchObject({ created: false, copy: { id: 'copy-1' } });
    });

    it('brings a menu’s dishes, reusing a dish the chef already adopted', async () => {
      const h = harness();
      const shared = suggestion({ id: 'shared' });
      const fresh = suggestion({ id: 'fresh' });
      const sugg = menuRow(
        { id: 'sugg-menu', chefProfileId: null, status: 'published' },
        [shared, fresh],
      );
      h.menu.findFirst.mockResolvedValue(sugg);
      // Read again inside the transaction, so an admin edit made meanwhile counts.
      h.menuDish.findMany.mockResolvedValue(sugg.dishes);
      h.menu.findUnique.mockResolvedValue(null);
      h.meal.findUnique.mockImplementation(async (args: unknown) => {
        const { where } = args as {
          where: { chefProfileId_sourceMealId: { sourceMealId: string } };
        };
        return where.chefProfileId_sourceMealId.sourceMealId === 'shared'
          ? dishRow({ id: 'my-shared' })
          : null;
      });
      h.meal.create.mockResolvedValue(dishRow({ id: 'my-fresh' }));

      const result = await service(h).adopt('clerk_1', 'sugg-menu', true);

      expect(result.created).toBe(true);
      expect(h.meal.create).toHaveBeenCalledTimes(1);
      expect(h.menu.create.mock.calls[0][0].data).toMatchObject({
        sourceMenuId: 'sugg-menu',
        shoppingIncluded: false,
        dishes: {
          create: [
            { mealId: 'my-shared', position: 0 },
            { mealId: 'my-fresh', position: 1 },
          ],
        },
      });
    });

    it('answers 404 for anything that is not a published suggestion', async () => {
      const h = harness();
      await expect(service(h).adopt('clerk_1', 'x', true)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(h.meal.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'x',
          chefProfileId: null,
          offeredToChefProfileId: null,
          status: MealStatus.published,
        },
      });
    });
  });

  it('lists suggestions as previews, never with the recipe', async () => {
    const h = harness();
    h.meal.findMany.mockResolvedValueOnce([suggestion()]).mockResolvedValueOnce([]);

    const { dishes } = await service(h).list('clerk_1');

    expect(dishes[0]).not.toHaveProperty('recipe');
    expect(dishes[0]).not.toHaveProperty('ingredients');
    expect(dishes[0].adoptedCopyId).toBeNull();
  });

  describe('offers', () => {
    it('only ever looks at offers made to the calling chef', async () => {
      const h = harness();
      await service(h).offers('clerk_1');

      expect(h.meal.findMany.mock.calls[0][0]).toMatchObject({
        where: { chefProfileId: null, offeredToChefProfileId: CHEF.id },
      });
    });

    it('transfers an accepted dish to the chef, re-checking the offer in the write', async () => {
      const h = harness();
      h.meal.findFirst.mockResolvedValue(suggestion({ offeredToChefProfileId: CHEF.id }));
      h.meal.updateMany.mockResolvedValue({ count: 1 });

      await service(h).accept('clerk_1', 'sugg-1', true);

      expect(h.meal.updateMany).toHaveBeenCalledWith({
        where: { id: 'sugg-1', chefProfileId: null, offeredToChefProfileId: CHEF.id },
        data: {
          chefProfileId: CHEF.id,
          offeredToChefProfileId: null,
          status: MealStatus.draft,
        },
      });
      expect(h.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'offer.accepted' }),
      );
    });

    it('answers 404 when the offer was withdrawn meanwhile', async () => {
      const h = harness();
      h.meal.findFirst.mockResolvedValue(suggestion({ offeredToChefProfileId: CHEF.id }));
      h.meal.updateMany.mockResolvedValue({ count: 0 });

      await expect(service(h).accept('clerk_1', 'sugg-1', true)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('sends a declined offer back to Lab’s Food as a draft', async () => {
      const h = harness();
      h.meal.updateMany.mockResolvedValue({ count: 1 });

      await service(h).decline('clerk_1', 'sugg-1');

      expect(h.meal.updateMany).toHaveBeenCalledWith({
        where: { id: 'sugg-1', chefProfileId: null, offeredToChefProfileId: CHEF.id },
        data: { offeredToChefProfileId: null, status: MealStatus.draft },
      });
    });
  });

  it('flags every copy of a changed suggestion and emails its chef', async () => {
    const h = harness();
    h.meal.findMany.mockResolvedValue([
      {
        id: 'copy-1',
        name: 'Poulet yassa',
        chefProfile: { user: { email: 'marie@exemple.fr', fullName: 'Marie' } },
      },
    ]);

    await service(h).flagCopies(suggestion() as never, 'admin-1');

    expect(h.meal.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['copy-1'] } },
      data: { sourceChangedAt: expect.any(Date) },
    });
    expect(h.mailer.sourceChanged).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'marie@exemple.fr', dishName: 'Poulet yassa' }),
    );
  });
});
