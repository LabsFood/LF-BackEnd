import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { Meal, MealStatus, Prisma } from '../../generated/prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { fridgeAlertDaysInForce } from '../platform-settings/fridge-alert';
import { ChefContentService, ChefContext, MENU_DISHES } from './chef-content.service';
import { DishesMailer } from './dishes.mailer';
import { toDishSummary, toDishView } from './dishes.views';
import { toMenuView } from './menus.service';

/**
 * A suggestion: Lab's Food content (no owner) that is published and offered to no
 * one in particular. Every chef sees it; nobody owns it (PRD decisions).
 */
export const SUGGESTION = {
  chefProfileId: null,
  offeredToChefProfileId: null,
  status: MealStatus.published,
} as const;

type Tx = Prisma.TransactionClient;

/**
 * FLOW-02 §6 and the PRD's offers: a chef previews Lab's Food suggestions and may
 * adopt one as a draft copy of their own; an admin may instead prepare content for
 * one chef, who alone sees it and makes it theirs by accepting. Every adoption and
 * acceptance is an audit row: that row is the consent proof §6 requires.
 */
@Injectable()
export class SuggestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ChefContentService,
    private readonly audit: AuditService,
    private readonly mailer: DishesMailer,
  ) {}

  /** The console's fridge threshold, for the `FRIDGE_LONG` warning of a dish view. */
  private fridgeDays() {
    return fridgeAlertDaysInForce(this.prisma);
  }

  /** §6: a preview only, never the recipe; `adoptedCopyId` says the chef has it. */
  async list(clerkUserId: string) {
    const chef = await this.access.chef(clerkUserId);
    const [dishes, menus] = await Promise.all([
      this.prisma.meal.findMany({ where: SUGGESTION, orderBy: { name: 'asc' } }),
      this.prisma.menu.findMany({
        where: SUGGESTION,
        include: MENU_DISHES,
        orderBy: { title: 'asc' },
      }),
    ]);
    const [dishCopies, menuCopies] = await Promise.all([
      this.prisma.meal.findMany({
        where: { chefProfileId: chef.id, sourceMealId: { in: dishes.map((d) => d.id) } },
        select: { id: true, sourceMealId: true },
      }),
      this.prisma.menu.findMany({
        where: { chefProfileId: chef.id, sourceMenuId: { in: menus.map((m) => m.id) } },
        select: { id: true, sourceMenuId: true },
      }),
    ]);
    const dishCopy = new Map(dishCopies.map((c) => [c.sourceMealId, c.id]));
    const menuCopy = new Map(menuCopies.map((c) => [c.sourceMenuId, c.id]));

    return {
      dishes: featuredFirst(dishes).map((dish) => ({
        ...toPreview(dish),
        adoptedCopyId: dishCopy.get(dish.id) ?? null,
      })),
      menus: menus.map((menu) => ({
        id: menu.id,
        title: menu.title,
        pitch: menu.pitch,
        period: menu.period,
        updatedAt: menu.updatedAt,
        dishes: menu.dishes.map(({ meal }) => toPreview(meal)),
        adoptedCopyId: menuCopy.get(menu.id) ?? null,
      })),
    };
  }

  /**
   * §6: copies a suggestion into the chef's space as a `draft`, with its lineage,
   * only on explicit consent. Idempotent per (chef, suggestion): adopting again
   * returns the copy already made. A menu brings its dishes, reusing any copy the
   * chef already has, so a dish shared by two menus is copied once.
   */
  async adopt(clerkUserId: string, id: string, consent: boolean) {
    const chef = await this.access.chef(clerkUserId);
    this.access.assertVerified(chef);
    assertConsent(consent);

    const dish = await this.prisma.meal.findFirst({ where: { id, ...SUGGESTION } });
    if (dish) {
      const { copy, created } = await retryOnConflict(() =>
        this.prisma.$transaction((tx) => copyDish(tx, chef, dish)),
      );
      if (created) {
        await this.recordConsent(chef, 'suggestion.adopted', 'meal', dish, {
          copyId: copy.id,
        });
      }
      return {
        type: 'dish' as const,
        created,
        copy: toDishView(copy, await this.fridgeDays()),
      };
    }

    const menu = await this.prisma.menu.findFirst({
      where: { id, ...SUGGESTION },
      include: MENU_DISHES,
    });
    if (!menu) throw new NotFoundException('No such suggestion.');

    const result = await retryOnConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const existing = await tx.menu.findUnique({
          where: {
            chefProfileId_sourceMenuId: { chefProfileId: chef.id, sourceMenuId: id },
          },
          include: MENU_DISHES,
        });
        if (existing) return { copy: existing, created: false, dishIds: [] as string[] };

        const dishIds: string[] = [];
        for (const meal of await dishesOf(tx, menu.id)) {
          dishIds.push((await copyDish(tx, chef, meal)).copy.id);
        }
        const copy = await tx.menu.create({
          data: {
            chefProfileId: chef.id,
            createdByUserId: menu.createdByUserId,
            sourceMenuId: menu.id,
            sourceVersion: menu.updatedAt,
            title: menu.title,
            pitch: menu.pitch,
            // Shared with the suggestion, as a dish's photo is: never deleted while used.
            imageUrl: menu.imageUrl,
            period: menu.period,
            // The chef decides whether they do the shopping (PRD).
            shoppingIncluded: false,
            status: MealStatus.draft,
            dishes: { create: dishIds.map((mealId, position) => ({ mealId, position })) },
          },
          include: MENU_DISHES,
        });
        return { copy, created: true, dishIds };
      }),
    );
    if (result.created) {
      await this.recordConsent(chef, 'suggestion.adopted', 'menu', menu, {
        copyId: result.copy.id,
        dishCopyIds: result.dishIds,
      });
    }
    return {
      type: 'menu' as const,
      created: result.created,
      copy: toMenuView(result.copy, await this.fridgeDays()),
    };
  }

  /** Content prepared for this chef and not yet accepted: a preview, like suggestions. */
  async offers(clerkUserId: string) {
    const chef = await this.access.chef(clerkUserId);
    const offered = { chefProfileId: null, offeredToChefProfileId: chef.id };
    const [dishes, menus] = await Promise.all([
      this.prisma.meal.findMany({ where: offered, orderBy: { updatedAt: 'desc' } }),
      this.prisma.menu.findMany({
        where: offered,
        include: MENU_DISHES,
        orderBy: { updatedAt: 'desc' },
      }),
    ]);
    return {
      dishes: featuredFirst(dishes).map(toPreview),
      menus: menus.map((menu) => ({
        id: menu.id,
        title: menu.title,
        pitch: menu.pitch,
        period: menu.period,
        updatedAt: menu.updatedAt,
        dishes: menu.dishes.map(({ meal }) => toPreview(meal)),
      })),
    };
  }

  /**
   * Accepting transfers the offered row itself, no copy: nobody else needs the
   * original. It becomes the chef's draft. An offered menu's dishes are Lab's Food
   * suggestions shared with others, so those are copied, as on an adoption.
   */
  async accept(clerkUserId: string, id: string, consent: boolean) {
    const chef = await this.access.chef(clerkUserId);
    this.access.assertVerified(chef);
    assertConsent(consent);
    const offeredToMe = { id, chefProfileId: null, offeredToChefProfileId: chef.id };
    const takeOver = {
      chefProfileId: chef.id,
      offeredToChefProfileId: null,
      status: MealStatus.draft,
    };

    const dish = await this.prisma.meal.findFirst({ where: offeredToMe });
    if (dish) {
      // The offer is re-checked in the write: withdrawn meanwhile, it matches nothing.
      const { count } = await this.prisma.meal.updateMany({
        where: offeredToMe,
        data: takeOver,
      });
      if (count === 0) throw new NotFoundException('No such offer.');
      await this.recordConsent(chef, 'offer.accepted', 'meal', dish, { copyId: dish.id });
      return {
        type: 'dish' as const,
        dish: toDishView(
          await this.prisma.meal.findUniqueOrThrow({ where: { id } }),
          await this.fridgeDays(),
        ),
      };
    }

    const menu = await this.prisma.menu.findFirst({
      where: offeredToMe,
      include: MENU_DISHES,
    });
    if (!menu) throw new NotFoundException('No such offer.');

    const accepted = await retryOnConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const { count } = await tx.menu.updateMany({
          where: offeredToMe,
          data: takeOver,
        });
        if (count === 0) throw new NotFoundException('No such offer.');
        const dishIds: string[] = [];
        for (const meal of await dishesOf(tx, id)) {
          dishIds.push((await copyDish(tx, chef, meal)).copy.id);
        }
        await tx.menuDish.deleteMany({ where: { menuId: id } });
        await tx.menuDish.createMany({
          data: dishIds.map((mealId, position) => ({ menuId: id, mealId, position })),
        });
        return tx.menu.findUniqueOrThrow({ where: { id }, include: MENU_DISHES });
      }),
    );
    await this.recordConsent(chef, 'offer.accepted', 'menu', menu, {
      copyId: id,
      dishCopyIds: accepted.dishes.map((d) => d.mealId),
    });
    return { type: 'menu' as const, menu: toMenuView(accepted, await this.fridgeDays()) };
  }

  /**
   * Declining leaves the content with Lab's Food, as a draft: free to re-offer or
   * to publish as a suggestion, but never published by accident.
   */
  async decline(clerkUserId: string, id: string): Promise<void> {
    const chef = await this.access.chef(clerkUserId);
    this.access.assertVerified(chef);
    const where = { id, chefProfileId: null, offeredToChefProfileId: chef.id };
    const back = { offeredToChefProfileId: null, status: MealStatus.draft };
    const [dishes, menus] = await this.prisma.$transaction([
      this.prisma.meal.updateMany({ where, data: back }),
      this.prisma.menu.updateMany({ where, data: back }),
    ]);
    if (dishes.count + menus.count === 0) throw new NotFoundException('No such offer.');
    await this.audit.record({
      actorType: 'chef',
      actorUserId: chef.userId,
      action: 'offer.declined',
      subjectType: dishes.count ? 'meal' : 'menu',
      subjectId: id,
    });
  }

  /**
   * A safety-relevant edit to a suggestion (allergens, diets, country): every copy
   * is flagged `source-changed` and its chef is told. The copy itself is left as
   * the chef made it (§6: nothing is imposed), and nothing is suspended.
   */
  async flagCopies(source: Meal, actorUserId: string): Promise<void> {
    const copies = await this.prisma.meal.findMany({
      where: { sourceMealId: source.id },
      select: {
        id: true,
        name: true,
        chefProfile: { select: { user: { select: { email: true, fullName: true } } } },
      },
    });
    if (copies.length === 0) return;

    const ids = copies.map((c) => c.id);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.meal.updateMany({
        where: { id: { in: ids } },
        data: { sourceChangedAt: now },
      }),
      // Into the review queue too, unless already waiting there (PRD).
      this.prisma.meal.updateMany({
        where: { id: { in: ids }, reviewPendingSince: null },
        data: { reviewPendingSince: now, reviewReason: 'source-changed' },
      }),
    ]);
    await Promise.all(
      copies.flatMap(({ name, chefProfile }) =>
        chefProfile
          ? [
              this.mailer.sourceChanged({
                email: chefProfile.user.email,
                name: chefProfile.user.fullName,
                dishName: name,
              }),
            ]
          : [],
      ),
    );
    await this.audit.record({
      actorType: 'admin',
      actorUserId,
      action: 'suggestion.source_changed',
      subjectType: 'meal',
      subjectId: source.id,
      metadata: { copyIds: copies.map((c) => c.id) },
    });
  }

  /** §6's consent proof: who, when (the row), which content, at which version. */
  private recordConsent(
    chef: ChefContext,
    action: 'suggestion.adopted' | 'offer.accepted',
    subjectType: 'meal' | 'menu',
    source: { id: string; updatedAt: Date },
    metadata: Record<string, unknown>,
  ) {
    return this.audit.record({
      actorType: 'chef',
      actorUserId: chef.userId,
      action,
      subjectType,
      subjectId: source.id,
      metadata: { ...metadata, sourceVersion: source.updatedAt, consent: true },
    });
  }
}

/**
 * A preview (§6): the dish without its recipe; a chef route, so with the times, and
 * whether the team featured it (« Mettre en vedette » in the console, feedback of 26/11).
 */
function toPreview(meal: Meal) {
  return {
    ...toDishSummary(meal),
    updatedAt: meal.updatedAt,
    isFeatured: meal.isFeatured,
  };
}

/** The featured dishes first; the order the query gave is kept within each part. */
function featuredFirst(meals: Meal[]): Meal[] {
  return [...meals.filter((m) => m.isFeatured), ...meals.filter((m) => !m.isFeatured)];
}

function assertConsent(consent: boolean): void {
  if (consent !== true) {
    throw new UnprocessableEntityException({
      code: 'CONSENT_REQUIRED',
      message:
        'Send `{ "consent": true }`: nothing is copied without your explicit consent.',
    });
  }
}

/**
 * The chef's copy of a Lab's Food dish: the one they already have, or a new draft
 * carrying the whole recipe, the suggestion's author and its version.
 */
async function copyDish(tx: Tx, chef: ChefContext, source: Meal) {
  const existing = await tx.meal.findUnique({
    where: {
      chefProfileId_sourceMealId: { chefProfileId: chef.id, sourceMealId: source.id },
    },
  });
  if (existing) return { copy: existing, created: false };

  const copy = await tx.meal.create({
    data: {
      chefProfileId: chef.id,
      createdByUserId: source.createdByUserId,
      sourceMealId: source.id,
      sourceVersion: source.updatedAt,
      status: MealStatus.draft,
      name: source.name,
      description: source.description,
      imageUrl: source.imageUrl,
      continent: source.continent,
      country: source.country,
      category: source.category,
      portions: source.portions,
      prepTime: source.prepTime,
      cookTime: source.cookTime,
      difficulty: source.difficulty,
      calories: source.calories,
      dietaryTags: source.dietaryTags,
      customDiets: source.customDiets,
      // Recettes §8.1: the computed allergens and the stamped lines, as they are.
      allergens: source.allergens,
      allergensNone: source.allergensNone,
      addedAllergens: source.addedAllergens,
      conditionalAllergens: source.conditionalAllergens,
      customAllergens: source.customAllergens,
      ingredients: source.ingredients ?? [],
      steps: source.steps ?? [],
      equipment: source.equipment,
      declaredDiets: source.declaredDiets,
      profiles: source.profiles,
      seasonsOverride: source.seasonsOverride,
      classification: source.classification ?? Prisma.DbNull,
      reheating: source.reheating ?? Prisma.DbNull,
      storage: source.storage ?? Prisma.DbNull,
    },
  });
  return { copy, created: true };
}

/**
 * The menu's dishes, read inside the transaction that copies them, so an admin
 * edit made in between is not lost.
 */
async function dishesOf(tx: Tx, menuId: string): Promise<Meal[]> {
  const rows = await tx.menuDish.findMany({
    where: { menuId },
    orderBy: { position: 'asc' },
    include: { meal: true },
  });
  return rows.map((row) => row.meal);
}

/**
 * Adoptions of the same content at once (a double click, two tabs) all try to
 * create the copy; the unique (chef, source) index lets one through and fails the
 * others with P2002. Each loser runs again in a fresh transaction and finds the
 * copies already made.
 */
async function retryOnConflict<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      const conflict =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
      if (!conflict || attempt === 3) throw error;
    }
  }
}
