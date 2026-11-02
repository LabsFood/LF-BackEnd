import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';

import { MealStatus } from '../../generated/prisma/client';
import {
  CHEF,
  codeOf,
  dishRow,
  harness,
  menuRow,
  readyDishRow,
} from './dishes.test-helpers';
import { MenusService } from './menus.service';

const service = (h: ReturnType<typeof harness>) => new MenusService(h.prisma, h.access);

describe('MenusService', () => {
  describe('create', () => {
    it('creates a draft of the chef’s own dishes, in order, shopping not included', async () => {
      const h = harness();
      h.meal.findMany.mockResolvedValue([dishRow({ id: 'd1' }), dishRow({ id: 'd2' })]);

      await service(h).create('clerk_1', { title: 'Semaine', dishIds: ['d2', 'd1'] });

      const { data } = h.menu.create.mock.calls[0][0];
      expect(data).toMatchObject({
        chefProfileId: CHEF.id,
        createdByUserId: CHEF.userId,
        status: MealStatus.draft,
        shoppingIncluded: false,
        dishes: {
          create: [
            { mealId: 'd2', position: 0 },
            { mealId: 'd1', position: 1 },
          ],
        },
      });
    });

    it('treats another chef’s dish as unknown, looking only among the chef’s own', async () => {
      const h = harness();

      await expect(
        service(h).create('clerk_1', { title: 'Semaine', dishIds: ['theirs'] }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(h.meal.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['theirs'] }, chefProfileId: CHEF.id },
      });
      expect(h.menu.create).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown dish id', async () => {
      const h = harness();
      await expect(
        service(h).create('clerk_1', { title: 'Semaine', dishIds: ['missing'] }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('publish (§3.4)', () => {
    it('publishes the menu and its draft dishes together', async () => {
      const h = harness();
      h.menu.findUnique.mockResolvedValue(
        menuRow({}, [
          readyDishRow({ id: 'd1' }),
          dishRow({ id: 'd2', status: 'published' }),
        ]),
      );

      await service(h).publish('clerk_1', 'menu-1');

      expect(h.$transaction).toHaveBeenCalledTimes(1);
      expect(h.meal.updateMany).toHaveBeenCalledTimes(1);
      expect(h.meal.updateMany).toHaveBeenCalledWith({
        where: { id: 'd1', chefProfileId: CHEF.id, status: MealStatus.draft },
        data: {
          status: MealStatus.published,
          publishedAt: expect.any(Date),
          // Published for the first time: into the admin review queue (§4.1).
          reviewReason: 'never-reviewed',
          reviewPendingSince: expect.any(Date),
        },
      });
      expect(h.menu.update.mock.calls[0][0].data).toMatchObject({
        status: MealStatus.published,
        reviewReason: 'never-reviewed',
      });
    });

    it('publishes nothing when one draft dish fails, and says which', async () => {
      const h = harness();
      h.menu.findUnique.mockResolvedValue(
        menuRow({}, [
          readyDishRow({ id: 'd1' }),
          readyDishRow({ id: 'd2', allergens: [] }),
        ]),
      );

      const error = await service(h)
        .publish('clerk_1', 'menu-1')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(codeOf(error)).toMatchObject({
        code: 'MENU_NOT_PUBLISHABLE',
        problems: { dishes: [expect.objectContaining({ dishId: 'd2' })] },
      });
      expect(h.$transaction).not.toHaveBeenCalled();
    });

    it('never lifts a suspended dish', async () => {
      const h = harness();
      h.menu.findUnique.mockResolvedValue(
        menuRow({}, [dishRow({ status: MealStatus.suspended })]),
      );

      await expect(service(h).publish('clerk_1', 'menu-1')).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('needs a validated dossier', async () => {
      const h = harness({ dossier: 'incomplete' });
      const error = await service(h)
        .publish('clerk_1', 'menu-1')
        .catch((e: unknown) => e);

      expect(codeOf(error).code).toBe('CHEF_NOT_VERIFIED');
    });
  });

  describe('update', () => {
    it('cannot skip review by unpublishing, editing and republishing', async () => {
      const h = harness();
      h.menu.findUnique.mockResolvedValue(
        menuRow({ status: MealStatus.draft, reviewedAt: new Date('2026-09-20') }),
      );

      await service(h).update('clerk_1', 'menu-1', { pitch: 'Tout autre chose.' });

      expect(h.menu.update.mock.calls[0][0].data.reviewReason).toBe(
        'edited-after-review',
      );
    });

    it('keeps a published menu from taking a draft dish', async () => {
      const h = harness();
      h.menu.findUnique.mockResolvedValue(menuRow({ status: MealStatus.published }));
      h.meal.findMany.mockResolvedValue([
        dishRow({ id: 'd9', status: MealStatus.draft }),
      ]);

      await expect(
        service(h).update('clerk_1', 'menu-1', { dishIds: ['d9'] }),
      ).rejects.toMatchObject({ response: { code: 'MENU_NOT_PUBLISHABLE' } });
      expect(h.menuDish.deleteMany).not.toHaveBeenCalled();
    });

    it('replaces the dish list of a draft menu, in the new order', async () => {
      const h = harness();
      h.meal.findMany.mockResolvedValue([dishRow({ id: 'd1' }), dishRow({ id: 'd2' })]);

      await service(h).update('clerk_1', 'menu-1', { dishIds: ['d2', 'd1'] });

      expect(h.menuDish.deleteMany).toHaveBeenCalledWith({ where: { menuId: 'menu-1' } });
      expect(h.menuDish.createMany).toHaveBeenCalledWith({
        data: [
          { menuId: 'menu-1', mealId: 'd2', position: 0 },
          { menuId: 'menu-1', mealId: 'd1', position: 1 },
        ],
      });
    });
  });

  describe('another chef’s menu (§8)', () => {
    it('is missing on a read and 403 on a write', async () => {
      const h = harness();
      h.menu.findUnique.mockResolvedValue(menuRow({ chefProfileId: 'chef-2' }));

      await expect(service(h).get('clerk_1', 'menu-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      const error = await service(h)
        .unpublish('clerk_1', 'menu-1')
        .catch((e: unknown) => e);
      expect(codeOf(error).code).toBe('CONTENT_NOT_OWNED');
    });
  });

  describe('showcase (§3.5)', () => {
    it('refuses a week that does not start on a Monday, or twice the same week', async () => {
      const h = harness();
      await expect(
        service(h).putShowcase('clerk_1', {
          assignments: [
            { weekStart: '2026-09-29', menuId: null },
            { weekStart: '2026-10-05', menuId: null },
            { weekStart: '2026-10-05', menuId: null },
          ],
        }),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_FAILED' } });
      expect(h.chefShowcaseWeek.upsert).not.toHaveBeenCalled();
    });

    it('refuses a menu that is not the chef’s', async () => {
      const h = harness();
      h.menu.count.mockResolvedValue(0);

      await expect(
        service(h).putShowcase('clerk_1', {
          assignments: [{ weekStart: '2026-09-28', menuId: 'theirs' }],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('assigns a menu, or explicitly none, week by week', async () => {
      const h = harness();
      h.menu.count.mockResolvedValue(1);

      await service(h).putShowcase('clerk_1', {
        assignments: [
          { weekStart: '2026-09-28', menuId: 'menu-1' },
          { weekStart: '2026-10-05', menuId: null },
        ],
      });

      expect(h.chefShowcaseWeek.upsert).toHaveBeenCalledTimes(2);
      expect(h.chefShowcaseWeek.upsert.mock.calls[1][0]).toMatchObject({
        create: { chefProfileId: CHEF.id, menuId: null },
        update: { menuId: null },
      });
    });
  });
});
