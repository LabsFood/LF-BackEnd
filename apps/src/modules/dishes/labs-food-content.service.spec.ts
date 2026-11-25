import { ConflictException, NotFoundException } from '@nestjs/common';

import { MealStatus } from '../../generated/prisma/client';
import { codeOf, dishRow, harness, menuRow } from './dishes.test-helpers';
import { LabsFoodContentService } from './labs-food-content.service';

const service = (h: ReturnType<typeof harness>) =>
  new LabsFoodContentService(h.prisma, h.audit);

describe("LabsFoodContentService (Lab's Food menus and offers)", () => {
  describe('offer', () => {
    it('prepares a meal for one chef, as a draft, and records who did it', async () => {
      const h = harness();
      h.meal.findUnique.mockResolvedValue({ chefProfileId: null });

      await service(h).offer('meal', 'meal-1', 'chef-2', 'admin-1');

      expect(h.meal.update).toHaveBeenCalledWith({
        where: { id: 'meal-1', chefProfileId: null },
        data: { offeredToChefProfileId: 'chef-2', status: MealStatus.draft },
      });
      expect(h.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'offer.made', actorUserId: 'admin-1' }),
      );
    });

    it('never touches a chef’s dish', async () => {
      const h = harness();
      h.meal.findUnique.mockResolvedValue({ chefProfileId: 'chef-1' });

      const error = await service(h)
        .offer('meal', 'meal-1', 'chef-2', 'admin-1')
        .catch((e: unknown) => e);

      expect(codeOf(error).code).toBe('CONTENT_NOT_OWNED');
      expect(h.meal.update).not.toHaveBeenCalled();
    });

    it('refuses a meal that sits in a Lab’s Food menu, which every adopter would get', async () => {
      const h = harness();
      h.meal.findUnique.mockResolvedValue({ chefProfileId: null });
      h.menuDish.count.mockResolvedValue(1);

      await expect(
        service(h).offer('meal', 'meal-1', 'chef-2', 'admin-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('answers 404 for an unknown batch cooker', async () => {
      const h = harness();
      h.chefProfile.findUnique.mockResolvedValue(null);

      await expect(
        service(h).offer('menu', 'menu-1', 'nobody', 'admin-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('menus', () => {
    it('composes only Lab’s Food meals that are not offered to someone', async () => {
      const h = harness();
      h.meal.findMany.mockResolvedValue([{ id: 'meal-1' }]);

      await expect(
        service(h).createMenu(
          { title: 'Semaine', dishIds: ['meal-1', 'offered'] },
          'admin-1',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(h.meal.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['meal-1', 'offered'] },
          chefProfileId: null,
          offeredToChefProfileId: null,
        },
        select: { id: true },
      });
    });

    it('records the admin as author, never as owner', async () => {
      const h = harness();
      h.menu.create.mockResolvedValue(menuRow({ chefProfileId: null }, [dishRow()]));

      await service(h).createMenu({ title: 'Semaine' }, 'admin-1');

      const { data } = h.menu.create.mock.calls[0][0];
      expect(data.createdByUserId).toBe('admin-1');
      expect(data).not.toHaveProperty('chefProfileId');
    });

    it('refuses to publish a menu still offered to a chef', async () => {
      const h = harness();
      h.menu.findUnique.mockResolvedValue({
        chefProfileId: null,
        offeredToChefProfileId: 'chef-2',
      });

      const error = await service(h)
        .updateMenu('menu-1', { status: 'published' })
        .catch((e: unknown) => e);

      expect(codeOf(error).code).toBe('OFFER_PENDING');
      expect(h.menu.update).not.toHaveBeenCalled();
    });

    it('refuses to change a chef’s menu', async () => {
      const h = harness();
      h.menu.findUnique.mockResolvedValue({ chefProfileId: 'chef-1' });

      const error = await service(h)
        .updateMenu('menu-1', { title: 'Mine now' })
        .catch((e: unknown) => e);

      expect(codeOf(error).code).toBe('CONTENT_NOT_OWNED');
    });
  });
});
