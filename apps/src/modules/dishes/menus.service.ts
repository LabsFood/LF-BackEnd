import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { MealStatus, MenuPeriod, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ChefContentService,
  ChefContext,
  MENU_DISHES,
  MenuWithDishes,
} from './chef-content.service';
import { changedMeanwhile, goneMeanwhile } from './dishes.service';
import { toDishView, toModeration } from './dishes.views';
import {
  CLEARED_MODERATION,
  nextReviewReason,
  reviewFields,
} from './domain/moderation.rules';
import { validationFailed } from './domain/content.errors';
import {
  hasMenuProblems,
  isMonday,
  MenuPublishProblems,
  menuPublishProblems,
} from './domain/menus.rules';
import { parisDay, weekOf } from './domain/vitrine.rules';
import { CreateMenuDto, PutShowcaseWeeksDto, UpdateMenuDto } from './dto/menu.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SHOWCASE_WEEKS = 8;
const MAX_SHOWCASE_WEEKS = 26;

/** A batch cooker's menus and their weekly showcase (FLOW-02 §3.4, §3.5). */
@Injectable()
export class MenusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ChefContentService,
  ) {}

  async list(clerkUserId: string) {
    const chef = await this.access.chef(clerkUserId);
    const menus = await this.prisma.menu.findMany({
      where: { chefProfileId: chef.id },
      include: MENU_DISHES,
      orderBy: { updatedAt: 'desc' },
    });
    return menus.map(toMenuView);
  }

  async get(clerkUserId: string, id: string) {
    const chef = await this.access.chef(clerkUserId);
    return toMenuView(await this.access.readableMenu(chef, id));
  }

  /** A `draft`, with `shoppingIncluded` false unless the chef says otherwise. */
  async create(clerkUserId: string, payload: CreateMenuDto) {
    const chef = await this.access.chef(clerkUserId);
    this.access.assertVerified(chef);
    const dishIds = payload.dishIds ?? [];
    await this.access.assertOwnDishes(chef, dishIds);

    const menu = await this.prisma.menu
      .create({
        data: {
          chefProfileId: chef.id,
          createdByUserId: chef.userId,
          title: payload.title,
          pitch: payload.pitch ?? null,
          period: (payload.period as MenuPeriod | undefined) ?? MenuPeriod.week,
          shoppingIncluded: payload.shoppingIncluded ?? false,
          status: MealStatus.draft,
          dishes: { create: dishIds.map((mealId, position) => ({ mealId, position })) },
        },
        include: MENU_DISHES,
      })
      .catch(dishGoneMeanwhile);
    return toMenuView(menu);
  }

  /**
   * A published menu stays published, so it may only take dishes that are
   * already public (§3.4). This check is for the chef's sake: what protects the
   * public is that every public read shows a menu's published dishes only, so a
   * dish suspended or unpublished at any moment drops out of its menus by itself.
   */
  async update(clerkUserId: string, id: string, payload: UpdateMenuDto) {
    const chef = await this.access.chef(clerkUserId);
    this.access.assertVerified(chef);
    const menu = await this.access.writableMenu(chef, id);
    const dishIds = payload.dishIds;
    if (dishIds) {
      const dishes = await this.access.assertOwnDishes(chef, dishIds);
      if (menu.status === MealStatus.published) {
        const notPublic = dishes.filter((dish) => dish.status !== MealStatus.published);
        if (notPublic.length || dishIds.length === 0) {
          throw menuNotPublishable({
            menu: dishIds.length
              ? []
              : [
                  {
                    code: 'VALIDATION_FAILED',
                    field: 'dishIds',
                    message: 'A published menu holds at least one dish.',
                  },
                ],
            dishes: notPublic.map((dish) => ({
              dishId: dish.id,
              name: dish.name,
              problems: [
                {
                  code: 'VALIDATION_FAILED',
                  field: 'status',
                  message:
                    'This menu is published: publish the dish first, or unpublish the menu.',
                },
              ],
            })),
          });
        }
      }
    }

    const updated = await this.prisma
      .$transaction(async (tx) => {
        if (dishIds) {
          await tx.menuDish.deleteMany({ where: { menuId: id } });
          await tx.menuDish.createMany({
            data: dishIds.map((mealId, position) => ({ menuId: id, mealId, position })),
          });
        }
        return tx.menu
          .update({
            where: { id, chefProfileId: chef.id },
            data: {
              ...(payload.title != null && { title: payload.title }),
              ...(payload.pitch !== undefined && { pitch: payload.pitch }),
              ...(payload.period != null && { period: payload.period as MenuPeriod }),
              ...(payload.shoppingIncluded != null && {
                shoppingIncluded: payload.shoppingIncluded,
              }),
              // A public menu changed, or one admins already reviewed: they look again,
              // so unpublishing, editing and republishing cannot skip the queue.
              ...((menu.status === MealStatus.published || menu.reviewedAt) &&
                reviewFields(menu, nextReviewReason(menu, 'edited'), new Date())),
            },
            include: MENU_DISHES,
          })
          .catch(goneMeanwhile('Menu'));
      })
      .catch(dishGoneMeanwhile);
    return toMenuView(updated);
  }

  async remove(clerkUserId: string, id: string): Promise<void> {
    const chef = await this.access.chef(clerkUserId);
    this.access.assertVerified(chef);
    await this.access.writableMenu(chef, id);
    // Showcase weeks pointing at it fall back to "no menu" (FK SET NULL).
    await this.prisma.menu
      .delete({ where: { id, chefProfileId: chef.id } })
      .catch(goneMeanwhile('Menu'));
  }

  /**
   * §3.4 with the PRD's rule: publishing the menu publishes its draft dishes, all
   * or nothing, each passing the same checks as on its own. Never lifts a
   * suspension. Every failure is reported at once.
   */
  async publish(clerkUserId: string, id: string) {
    const chef = await this.access.chef(clerkUserId);
    await this.access.assertCanPublish(chef);
    const menu = await this.access.writableMenu(chef, id);
    if (menu.status === MealStatus.published) return toMenuView(menu);

    const problems = menuPublishProblems(
      menu,
      menu.dishes.map(({ meal }) => meal),
    );
    if (hasMenuProblems(problems)) throw menuNotPublishable(problems);

    const now = new Date();
    const drafts = menu.dishes
      .map(({ meal }) => meal)
      .filter((meal) => meal.status === MealStatus.draft);
    const republished = menu.status === MealStatus.suspended;
    const published = await this.prisma
      .$transaction(async (tx) => {
        for (const dish of drafts) {
          // `status: draft` in the filter: a dish suspended meanwhile stays suspended.
          await tx.meal.updateMany({
            where: { id: dish.id, chefProfileId: chef.id, status: MealStatus.draft },
            data: {
              status: MealStatus.published,
              publishedAt: now,
              ...reviewFields(dish, nextReviewReason(dish, 'published'), now),
            },
          });
        }
        // The status read above is part of the write, so an admin decision made
        // meanwhile is never overwritten: the whole publication fails instead.
        return tx.menu.update({
          where: { id, chefProfileId: chef.id, status: menu.status },
          data: {
            status: MealStatus.published,
            publishedAt: now,
            ...reviewFields(
              menu,
              nextReviewReason(
                menu,
                republished ? 'republished-after-suspension' : 'published',
              ),
              now,
            ),
            ...(republished && CLEARED_MODERATION),
          },
          include: MENU_DISHES,
        });
      })
      .catch(changedMeanwhile);
    return toMenuView(published);
  }

  /** Back to `draft`. Its dishes stay published: they are the chef's on their own. */
  async unpublish(clerkUserId: string, id: string) {
    const chef = await this.access.chef(clerkUserId);
    this.access.assertVerified(chef);
    const menu = await this.access.writableMenu(chef, id);
    if (menu.status !== MealStatus.published) return toMenuView(menu);

    // Only from `published`: a suspension made meanwhile is never overwritten.
    const drafted = await this.prisma.menu
      .update({
        where: { id, chefProfileId: chef.id, status: MealStatus.published },
        data: { status: MealStatus.draft },
        include: MENU_DISHES,
      })
      .catch(changedMeanwhile);
    return toMenuView(drafted);
  }

  /** The chef's showcase between two Mondays; by default the next eight weeks. */
  async showcase(clerkUserId: string, range: { from?: string; to?: string } = {}) {
    const chef = await this.access.chef(clerkUserId);
    return this.showcaseOf(chef, range);
  }

  /**
   * §3.5: assigns a menu, or explicitly none, to each week given. Weeks left out
   * keep their assignment. Only the chef's own menus; a draft menu may be
   * assigned, and shows publicly once published.
   */
  async putShowcase(clerkUserId: string, payload: PutShowcaseWeeksDto) {
    const chef = await this.access.chef(clerkUserId);
    this.access.assertVerified(chef);
    const weeks = payload.assignments.map((a) => a.weekStart);
    const problems = [
      ...weeks.filter((day) => !isMonday(day)).map((day) => `${day} is not a Monday.`),
      ...weeks
        .filter((day, i) => weeks.indexOf(day) !== i)
        .map((day) => `${day} is given twice.`),
    ];
    if (problems.length) throw validationFailed(problems.join(' '), { problems });

    const menuIds = [
      ...new Set(payload.assignments.flatMap((a) => (a.menuId ? [a.menuId] : []))),
    ];
    if (menuIds.length) {
      const owned = await this.prisma.menu.count({
        where: { id: { in: menuIds }, chefProfileId: chef.id },
      });
      if (owned !== menuIds.length) {
        throw new NotFoundException('One of the menus is not among yours.');
      }
    }

    await this.prisma.$transaction(
      payload.assignments.map(({ weekStart, menuId }) =>
        this.prisma.chefShowcaseWeek.upsert({
          where: {
            chefProfileId_weekStart: {
              chefProfileId: chef.id,
              weekStart: toDate(weekStart),
            },
          },
          create: { chefProfileId: chef.id, weekStart: toDate(weekStart), menuId },
          update: { menuId },
        }),
      ),
    );

    const sorted = [...weeks].sort();
    return this.showcaseOf(chef, { from: sorted[0], to: sorted[sorted.length - 1] });
  }

  private async showcaseOf(chef: ChefContext, range: { from?: string; to?: string }) {
    const from = weekOf(range.from ?? parisDay(new Date())).start;
    const to =
      range.to ??
      toDay(new Date(toDate(from).getTime() + (DEFAULT_SHOWCASE_WEEKS - 1) * 7 * DAY_MS));
    const span = toDate(to).getTime() - toDate(from).getTime();
    if (span < 0) throw validationFailed('`to` is before `from`.');
    if (span > MAX_SHOWCASE_WEEKS * 7 * DAY_MS) {
      throw validationFailed(`Ask for ${MAX_SHOWCASE_WEEKS} weeks at most.`);
    }
    const rows = await this.prisma.chefShowcaseWeek.findMany({
      where: {
        chefProfileId: chef.id,
        weekStart: { gte: toDate(from), lte: toDate(to) },
      },
      include: { menu: { select: { id: true, title: true, status: true } } },
      orderBy: { weekStart: 'asc' },
    });
    return {
      from,
      to,
      weeks: rows.map((row) => ({ weekStart: toDay(row.weekStart), menu: row.menu })),
    };
  }
}

/** One of `dishIds` was deleted between the ownership check and the write. */
function dishGoneMeanwhile(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
    throw new NotFoundException('One of the dishes was deleted meanwhile.');
  }
  throw error;
}

/** `422 MENU_NOT_PUBLISHABLE`, listing the menu's own problems and each dish's. */
function menuNotPublishable(problems: MenuPublishProblems) {
  return new UnprocessableEntityException({
    code: 'MENU_NOT_PUBLISHABLE',
    message: 'This menu cannot be published as it is.',
    problems,
  });
}

const toDate = (day: string) => new Date(`${day}T00:00:00Z`);
const toDay = (date: Date) => date.toISOString().slice(0, 10);

/** The chef's view of a menu: its dishes in order, each with its status. */
export function toMenuView(menu: MenuWithDishes) {
  return {
    id: menu.id,
    title: menu.title,
    pitch: menu.pitch,
    imageUrl: menu.imageUrl,
    period: menu.period,
    status: menu.status,
    shoppingIncluded: menu.shoppingIncluded,
    publishedAt: menu.publishedAt,
    moderation: toModeration(menu),
    createdAt: menu.createdAt,
    updatedAt: menu.updatedAt,
    // The same dish view as `GET /me/dishes`, in menu order.
    dishes: menu.dishes.map(({ meal }) => toDishView(meal)),
  };
}
