import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { MealStatus, MenuPeriod } from '../../generated/prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { fridgeAlertDaysInForce } from '../platform-settings/fridge-alert';
import { MENU_DISHES, MenuWithDishes } from './chef-content.service';
import { contentNotOwned, offerPending } from './domain/content.errors';
import { CreateLabsFoodMenuDto, UpdateLabsFoodMenuDto } from './dto/labs-food.dto';
import { toMenuView } from './menus.service';

/** Lab's Food content: no batch cooker owns it. */
const LABS_FOOD = { chefProfileId: null };

/**
 * What admins write for every chef (suggestions) or for one (offers). Admins never
 * set an owner: ownership moves only when a chef adopts or accepts (PRD).
 */
@Injectable()
export class LabsFoodContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listMenus() {
    const menus = await this.prisma.menu.findMany({
      where: LABS_FOOD,
      include: MENU_DISHES,
      orderBy: { updatedAt: 'desc' },
    });
    const days = await fridgeAlertDaysInForce(this.prisma);
    return menus.map((menu) => toAdminMenuView(menu, days));
  }

  async createMenu(payload: CreateLabsFoodMenuDto, adminUserId: string) {
    const dishIds = payload.dishIds ?? [];
    await this.assertComposable(dishIds);
    const menu = await this.prisma.menu.create({
      data: {
        createdByUserId: adminUserId,
        title: payload.title,
        pitch: payload.pitch ?? null,
        period: (payload.period as MenuPeriod | undefined) ?? MenuPeriod.week,
        shoppingIncluded: payload.shoppingIncluded ?? false,
        status: (payload.status as MealStatus | undefined) ?? MealStatus.draft,
        dishes: { create: dishIds.map((mealId, position) => ({ mealId, position })) },
      },
      include: MENU_DISHES,
    });
    return toAdminMenuView(menu, await fridgeAlertDaysInForce(this.prisma));
  }

  /** Any admin may edit Lab's Food content, not only its author (PRD). */
  async updateMenu(id: string, payload: UpdateLabsFoodMenuDto) {
    const current = await this.labsFoodMenu(id);
    if (payload.status === 'published' && current.offeredToChefProfileId) {
      throw offerPending();
    }
    if (payload.dishIds) await this.assertComposable(payload.dishIds);
    const dishIds = payload.dishIds;
    const menu = await this.prisma.$transaction(async (tx) => {
      if (dishIds) {
        await tx.menuDish.deleteMany({ where: { menuId: id } });
        await tx.menuDish.createMany({
          data: dishIds.map((mealId, position) => ({ menuId: id, mealId, position })),
        });
      }
      return tx.menu.update({
        where: { id, ...LABS_FOOD },
        data: {
          ...(payload.title != null && { title: payload.title }),
          ...(payload.pitch !== undefined && { pitch: payload.pitch }),
          ...(payload.period != null && { period: payload.period as MenuPeriod }),
          ...(payload.shoppingIncluded != null && {
            shoppingIncluded: payload.shoppingIncluded,
          }),
          ...(payload.status != null && { status: payload.status as MealStatus }),
        },
        include: MENU_DISHES,
      });
    });
    return toAdminMenuView(menu, await fridgeAlertDaysInForce(this.prisma));
  }

  async deleteMenu(id: string): Promise<void> {
    await this.labsFoodMenu(id);
    await this.prisma.menu.delete({ where: { id, ...LABS_FOOD } });
  }

  /**
   * Prepares a meal or a menu for one chef: from now on only they see it, as an
   * offer, and it leaves the public suggestions. It becomes a draft, so it never
   * returns to the suggestions on its own. Offering again moves it to another chef.
   */
  async offer(
    kind: 'meal' | 'menu',
    id: string,
    chefProfileId: string,
    adminUserId: string,
  ) {
    const chef = await this.prisma.chefProfile.findUnique({
      where: { id: chefProfileId },
      select: { id: true },
    });
    if (!chef) throw new NotFoundException('No batch cooker with this id.');

    if (kind === 'meal') {
      await this.labsFoodMeal(id);
      // A meal inside a Lab's Food menu would reach every chef who adopts that menu.
      const inMenus = await this.prisma.menuDish.count({
        where: { mealId: id, menu: LABS_FOOD },
      });
      if (inMenus) {
        throw new ConflictException({
          code: 'MEAL_IN_MENU',
          message:
            "This meal is part of a Lab's Food menu. Offer the menu, or take the meal " +
            'out of it first.',
        });
      }
      await this.prisma.meal.update({
        where: { id, ...LABS_FOOD },
        data: { offeredToChefProfileId: chefProfileId, status: MealStatus.draft },
      });
    } else {
      await this.labsFoodMenu(id);
      await this.prisma.menu.update({
        where: { id, ...LABS_FOOD },
        data: { offeredToChefProfileId: chefProfileId, status: MealStatus.draft },
      });
    }
    await this.audit.record({
      actorType: 'admin',
      actorUserId: adminUserId,
      action: 'offer.made',
      subjectType: kind,
      subjectId: id,
      metadata: { chefProfileId },
    });
    return { kind, id, offeredToChefProfileId: chefProfileId };
  }

  /** Takes an offer back before the chef accepts: it stays with Lab's Food, as a draft. */
  async withdrawOffer(kind: 'meal' | 'menu', id: string, adminUserId: string) {
    if (kind === 'meal') {
      await this.labsFoodMeal(id);
      await this.prisma.meal.update({
        where: { id, ...LABS_FOOD },
        data: { offeredToChefProfileId: null },
      });
    } else {
      await this.labsFoodMenu(id);
      await this.prisma.menu.update({
        where: { id, ...LABS_FOOD },
        data: { offeredToChefProfileId: null },
      });
    }
    await this.audit.record({
      actorType: 'admin',
      actorUserId: adminUserId,
      action: 'offer.withdrawn',
      subjectType: kind,
      subjectId: id,
    });
  }

  /** A Lab's Food menu holds Lab's Food meals, none of them prepared for one chef. */
  private async assertComposable(dishIds: string[]) {
    if (dishIds.length === 0) return;
    const found = await this.prisma.meal.findMany({
      where: { id: { in: dishIds }, ...LABS_FOOD, offeredToChefProfileId: null },
      select: { id: true },
    });
    const ok = new Set(found.map((row) => row.id));
    const refused = dishIds.filter((id) => !ok.has(id));
    if (refused.length) {
      throw new NotFoundException(
        `Not Lab's Food meals free to use in a menu: ${refused.join(', ')}. Meals ` +
          'offered to one batch cooker cannot go in a menu.',
      );
    }
  }

  private async labsFoodMeal(id: string) {
    const meal = await this.prisma.meal.findUnique({
      where: { id },
      select: { chefProfileId: true },
    });
    if (!meal) throw new NotFoundException('Meal not found.');
    if (meal.chefProfileId) throw contentNotOwned('This meal belongs to a batch cooker.');
  }

  private async labsFoodMenu(id: string) {
    const menu = await this.prisma.menu.findUnique({
      where: { id },
      select: { chefProfileId: true, offeredToChefProfileId: true },
    });
    if (!menu) throw new NotFoundException('Menu not found.');
    if (menu.chefProfileId) throw contentNotOwned('This menu belongs to a batch cooker.');
    return menu;
  }
}

/** The admin view of a Lab's Food menu: the chef view plus authorship and offer. */
export function toAdminMenuView(menu: MenuWithDishes, fridgeAlertDays?: number) {
  return {
    ...toMenuView(menu, fridgeAlertDays),
    createdByUserId: menu.createdByUserId,
    offeredToChefProfileId: menu.offeredToChefProfileId,
  };
}
