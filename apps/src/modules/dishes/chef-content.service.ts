import { Injectable, NotFoundException } from '@nestjs/common';

import {
  ChefApplication,
  ChefProfile,
  Meal,
  Menu,
  Prisma,
} from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  isDisabledByAdmin,
  toWire,
} from '../chef-onboarding/domain/chef-onboarding.rules';
import { ChefDocumentsService } from '../chef-onboarding/services/chef-documents.service';
import { chefNotVerified, contentNotOwned } from './domain/content.errors';

export type ChefContext = ChefProfile & { application: ChefApplication | null };

/** A menu's dishes, in the order the chef set. */
export const MENU_DISHES = {
  dishes: { orderBy: { position: 'asc' }, include: { meal: true } },
} satisfies Prisma.MenuInclude;

export type MenuWithDishes = Menu & {
  dishes: Prisma.MenuDishGetPayload<{ include: { meal: true } }>[];
};

/**
 * Who the calling batch cooker is, and what they may do with a given dish or menu.
 * Every chef route goes through here, so the FLOW-02 §8 access rule lives in one
 * place: another chef's content is missing on a read and `403 CONTENT_NOT_OWNED`
 * on a write.
 */
@Injectable()
export class ChefContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: ChefDocumentsService,
  ) {}

  async chef(clerkUserId: string): Promise<ChefContext> {
    const profile = await this.prisma.chefProfile.findFirst({
      where: { user: { clerkUserId } },
      include: { application: true },
    });
    if (!profile) {
      throw new NotFoundException('No batch cooker profile for this account.');
    }
    return profile;
  }

  /** Browse-only until the candidature is approved (FLOW-01). */
  assertVerified(chef: ChefContext): void {
    if (!chef.isVerified) {
      throw chefNotVerified(
        'Your candidature must be approved before you can write dishes or menus.',
      );
    }
  }

  /**
   * §3.3: publishing needs an approved chef **and** a dossier validated right now,
   * so a chef whose blocking document expired cannot put anything new online.
   */
  async assertCanPublish(chef: ChefContext): Promise<void> {
    // Recettes R34: which chef tiers may publish is not decided (BLK-26). The tier
    // check goes here, answering `tierCannotPublish` (content.errors.ts).
    this.assertVerified(chef);
    const status = chef.application
      ? this.documents.deriveStatus(
          await this.documents.latestPerType(chef.id),
          this.documents.answersOf(chef.application),
          isDisabledByAdmin(chef),
        )
      : 'draft';
    if (status !== 'validated') {
      throw chefNotVerified(
        `Your dossier must be validated to publish; it is \`${toWire(status)}\`.`,
      );
    }
  }

  /** One of the chef's dishes. Someone else's is reported missing, never revealed. */
  async readableDish(chef: ChefContext, id: string): Promise<Meal> {
    const dish = await this.prisma.meal.findUnique({ where: { id } });
    if (!dish || dish.chefProfileId !== chef.id) {
      throw new NotFoundException('Dish not found.');
    }
    return dish;
  }

  /** One of the chef's dishes, about to be changed: §8 answers 403 for another's. */
  async writableDish(chef: ChefContext, id: string): Promise<Meal> {
    const dish = await this.prisma.meal.findUnique({ where: { id } });
    if (!dish) throw new NotFoundException('Dish not found.');
    if (dish.chefProfileId !== chef.id) {
      throw contentNotOwned('This dish is not yours.');
    }
    return dish;
  }

  /** One of the chef's menus, with its dishes in order. Another's is missing. */
  async readableMenu(chef: ChefContext, id: string): Promise<MenuWithDishes> {
    const menu = await this.prisma.menu.findUnique({
      where: { id },
      include: MENU_DISHES,
    });
    if (!menu || menu.chefProfileId !== chef.id) {
      throw new NotFoundException('Menu not found.');
    }
    return menu;
  }

  /** One of the chef's menus, about to be changed: 403 for another's (§8). */
  async writableMenu(chef: ChefContext, id: string): Promise<MenuWithDishes> {
    const menu = await this.prisma.menu.findUnique({
      where: { id },
      include: MENU_DISHES,
    });
    if (!menu) throw new NotFoundException('Menu not found.');
    if (menu.chefProfileId !== chef.id) {
      throw contentNotOwned('This menu is not yours.');
    }
    return menu;
  }

  /**
   * A chef's menu holds only their own dishes (PRD: a chef never reads or copies
   * another chef's content). Someone else's dish is reported like an unknown one,
   * so this cannot be used to learn that a given id exists.
   */
  async assertOwnDishes(chef: ChefContext, ids: string[]): Promise<Meal[]> {
    if (ids.length === 0) return [];
    const dishes = await this.prisma.meal.findMany({
      where: { id: { in: ids }, chefProfileId: chef.id },
    });
    const found = new Set(dishes.map((dish) => dish.id));
    const unknown = ids.filter((id) => !found.has(id));
    if (unknown.length) {
      throw new NotFoundException(`Not among your dishes: ${unknown.join(', ')}.`);
    }
    return dishes;
  }
}
