import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { Meal, MealStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  assertConsistent,
  SAFETY_FIELDS,
  toIngredientsJson,
  toReheatingJson,
  toStorageJson,
} from '../dishes/dishes.service';
import { contentNotOwned, offerPending } from '../dishes/domain/content.errors';
import { SuggestionsService } from '../dishes/suggestions.service';
import {
  CreateMealDto,
  CreateMenuWeekDto,
  UpdateFormuleDto,
  UpdateMealDto,
  UpdateMenuWeekDto,
} from './dto/catalog-admin.dto';

/**
 * A Lab's Food meal is one no batch cooker owns. The admin routes here predate
 * chef dishes, so every read and write they make is limited to those rows.
 */
const LABS_FOOD = { chefProfileId: null };

const WITH_MEALS = { meals: { include: { meal: true } } } as const;

export const NOT_LABS_FOOD =
  "This dish belongs to a batch cooker. Only Lab's Food meals can be changed here.";

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly suggestions: SuggestionsService,
  ) {}

  listMeals() {
    return this.prisma.meal.findMany({
      where: LABS_FOOD,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Always an unowned Lab's Food meal; the admin is recorded as its author only. */
  async createMeal(payload: CreateMealDto, adminUserId: string) {
    assertConsistent(declarationOf(null, payload));
    return this.prisma.meal.create({
      data: {
        createdByUserId: adminUserId,
        name: payload.name,
        description: payload.description,
        imageUrl: payload.imageUrl ?? null,
        continent: payload.continent ?? null,
        country: payload.country ?? null,
        // Left undefined when omitted so Prisma applies the schema defaults
        // (portions 4, steps [], isFeatured false).
        portions: payload.portions,
        prepTime: payload.prepTime,
        dietaryTags: payload.dietaryTags ?? [],
        customDiets: payload.customDiets ?? [],
        allergens: payload.allergens ?? [],
        allergensNone: payload.allergensNone ?? false,
        customAllergens: payload.customAllergens ?? [],
        calories: payload.calories ?? null,
        difficulty: payload.difficulty ?? null,
        category: payload.category ?? null,
        cookTime: payload.cookTime ?? null,
        ingredients: toIngredientsJson(payload.ingredients ?? []),
        steps: payload.steps,
        reheating: toReheatingJson(payload.reheating),
        storage: toStorageJson(payload.storage),
        isFeatured: payload.isFeatured,
        status: payload.status ?? MealStatus.draft,
      },
    });
  }

  /**
   * The owner filter sits in the `where`, so the check and the write are one
   * statement: no gap in which the row could change hands in between.
   */
  async updateMeal(id: string, payload: UpdateMealDto, adminUserId: string) {
    let current: Meal | null = null;
    const publishing = payload.status === MealStatus.published;
    if (touchesDeclaration(payload) || payload.country !== undefined || publishing) {
      current = await this.prisma.meal.findFirst({ where: { id, ...LABS_FOOD } });
      if (!current) return this.explainMissing(id);
      assertConsistent(declarationOf(current, payload));
      if (publishing && current.offeredToChefProfileId) throw offerPending();
    }
    let updated: Meal;
    try {
      updated = await this.prisma.meal.update({
        where: { id, ...LABS_FOOD },
        data: CatalogService.toMealUpdateData(payload),
      });
    } catch (error) {
      if (isNotFound(error)) return this.explainMissing(id);
      throw error;
    }
    // Chefs who adopted this suggestion hear about a safety change (§6, PRD).
    if (current && safetyChanged(current, updated)) {
      await this.suggestions.flagCopies(updated, adminUserId);
    }
    return updated;
  }

  /** A write matched nothing: the meal is gone, or it belongs to a batch cooker. */
  private async explainMissing(id: string): Promise<never> {
    const row = await this.prisma.meal.findUnique({
      where: { id },
      select: { chefProfileId: true },
    });
    if (row) throw contentNotOwned(NOT_LABS_FOOD);
    throw new NotFoundException('Meal not found.');
  }

  /**
   * Maps a patch payload onto Prisma update input.
   *
   * Nullable columns accept an explicit `null` so an admin can clear them; the
   * non-nullable ones ignore `null` (class-validator's `@IsOptional()` skips
   * validation on null, so it would otherwise reach Prisma and fail at runtime).
   */
  private static toMealUpdateData(payload: UpdateMealDto): Prisma.MealUpdateInput {
    const data: Prisma.MealUpdateInput = {};

    if (payload.description !== undefined) data.description = payload.description;
    if (payload.imageUrl !== undefined) data.imageUrl = payload.imageUrl;
    if (payload.continent !== undefined) data.continent = payload.continent;
    if (payload.country !== undefined) data.country = payload.country;
    if (payload.calories !== undefined) data.calories = payload.calories;
    if (payload.difficulty !== undefined) data.difficulty = payload.difficulty;
    if (payload.category !== undefined) data.category = payload.category;
    if (payload.cookTime !== undefined) data.cookTime = payload.cookTime;
    if (payload.reheating !== undefined)
      data.reheating = toReheatingJson(payload.reheating);
    if (payload.storage !== undefined) data.storage = toStorageJson(payload.storage);

    if (payload.name != null) data.name = payload.name;
    if (payload.portions != null) data.portions = payload.portions;
    if (payload.prepTime != null) data.prepTime = payload.prepTime;
    if (payload.dietaryTags != null) data.dietaryTags = payload.dietaryTags;
    if (payload.allergens != null) data.allergens = payload.allergens;
    if (payload.allergensNone != null) data.allergensNone = payload.allergensNone;
    if (payload.customDiets != null) data.customDiets = payload.customDiets;
    if (payload.customAllergens != null) data.customAllergens = payload.customAllergens;
    if (payload.ingredients != null) {
      data.ingredients = toIngredientsJson(payload.ingredients);
    }
    if (payload.steps != null) data.steps = payload.steps;
    if (payload.isFeatured != null) data.isFeatured = payload.isFeatured;
    if (payload.status != null) data.status = payload.status;

    // A new recipe version; bookings keep the one they pinned (FLOW-02 §9.2).
    const recipeTouched = [
      payload.ingredients,
      payload.steps,
      payload.reheating,
      payload.storage,
      payload.portions,
    ].some((value) => value !== undefined && value !== null);
    if (recipeTouched) data.recipeVersion = { increment: 1 };

    return data;
  }

  async deleteMeal(id: string): Promise<void> {
    try {
      await this.prisma.meal.delete({ where: { id, ...LABS_FOOD } });
    } catch (error) {
      if (isNotFound(error)) return this.explainMissing(id);
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        // booking_meals.meal_id is ON DELETE RESTRICT, so meals already served
        // in a booking cannot be removed without losing booking history.
        if (error.code === 'P2003') {
          throw new ConflictException(
            'Meal is referenced by existing bookings and cannot be deleted. ' +
              'Set its status to `archived` instead.',
          );
        }
      }
      throw error;
    }
  }

  listMenuWeeks() {
    return this.prisma.menuWeek.findMany({
      orderBy: [{ year: 'desc' }, { weekNumber: 'desc' }],
      include: WITH_MEALS,
    });
  }

  async createMenuWeek(payload: CreateMenuWeekDto) {
    const mealIds = await this.menuMealIds(payload.mealIds);
    try {
      const week = await this.prisma.menuWeek.create({
        data: {
          year: payload.year,
          weekNumber: payload.weekNumber,
          publishedAt: null,
          meals: mealIds.length ? { create: mealIds.map(onMenu) } : undefined,
        },
        include: WITH_MEALS,
      });
      this.logger.log({
        event: 'menu_week.created',
        menuWeekId: week.id,
        mealCount: mealIds.length,
      });
      return week;
    } catch (error) {
      if (isUniqueViolation(error)) throw weekTaken();
      throw error;
    }
  }

  /** `mealIds`, when sent, replaces the whole list in the same write. */
  async updateMenuWeek(id: string, payload: UpdateMenuWeekDto) {
    // null is ignored like an omitted field: `@IsOptional()` lets it through.
    const mealIds =
      payload.mealIds != null ? await this.menuMealIds(payload.mealIds) : undefined;
    try {
      const week = await this.prisma.menuWeek.update({
        where: { id },
        data: {
          year: payload.year ?? undefined,
          weekNumber: payload.weekNumber ?? undefined,
          meals: mealIds && { deleteMany: {}, create: mealIds.map(onMenu) },
        },
        include: WITH_MEALS,
      });
      this.logger.log({
        event: 'menu_week.updated',
        menuWeekId: id,
        mealCount: week.meals.length,
      });
      return week;
    } catch (error) {
      if (isNotFound(error)) throw menuWeekNotFound();
      if (isUniqueViolation(error)) throw weekTaken();
      throw error;
    }
  }

  /** Its meals stay in the catalog; only their place on this menu goes (FK cascade). */
  async deleteMenuWeek(id: string): Promise<void> {
    try {
      await this.prisma.menuWeek.delete({ where: { id } });
    } catch (error) {
      if (isNotFound(error)) throw menuWeekNotFound();
      throw error;
    }
    this.logger.log({ event: 'menu_week.deleted', menuWeekId: id });
  }

  /**
   * Only Lab's Food meals can go on the global weekly menu: putting a chef's dish
   * there would publish it without the chef's consent. Returns each id once.
   */
  private async menuMealIds(ids: string[] = []): Promise<string[]> {
    const mealIds = [...new Set(ids)];
    if (!mealIds.length) return mealIds;
    const found = await this.prisma.meal.findMany({
      where: { id: { in: mealIds } },
      select: { id: true, chefProfileId: true, offeredToChefProfileId: true },
    });
    const known = new Set(found.map((row) => row.id));
    const unknown = mealIds.filter((id) => !known.has(id));
    if (unknown.length) {
      throw new NotFoundException(`Unknown meal ids: ${unknown.join(', ')}.`);
    }
    // An offered meal is prepared for one chef and may become theirs at any time.
    if (found.some((row) => row.chefProfileId || row.offeredToChefProfileId)) {
      throw contentNotOwned(
        "Only Lab's Food meals not offered to a batch cooker can go on a weekly menu.",
      );
    }
    return mealIds;
  }

  listFormules() {
    return this.prisma.formule.findMany({ orderBy: { createdAt: 'desc' } });
  }

  updateFormule(id: string, payload: UpdateFormuleDto) {
    return this.prisma.formule.update({
      where: { id },
      data: payload,
    });
  }
}

/** The allergen and diet declaration once `payload` is applied to `current`. */
function declarationOf(current: Meal | null, payload: UpdateMealDto) {
  return {
    allergens: payload.allergens ?? current?.allergens ?? [],
    allergensNone: payload.allergensNone ?? current?.allergensNone ?? false,
    customAllergens: payload.customAllergens ?? current?.customAllergens ?? [],
    diets: payload.dietaryTags ?? current?.dietaryTags ?? [],
    customDiets: payload.customDiets ?? current?.customDiets ?? [],
  };
}

/** Whether allergens, diets or country differ between two versions of a meal. */
function safetyChanged(before: Meal, after: Meal): boolean {
  // Lists are sets here: the same allergens in another order are no change.
  const canonical = (value: unknown) =>
    JSON.stringify(Array.isArray(value) ? [...value].sort() : value);
  return SAFETY_FIELDS.some(
    (field) => canonical(before[field]) !== canonical(after[field]),
  );
}

const touchesDeclaration = (payload: UpdateMealDto) =>
  [
    payload.allergens,
    payload.allergensNone,
    payload.customAllergens,
    payload.dietaryTags,
    payload.customDiets,
  ].some((value) => value != null);

const onMenu = (mealId: string) => ({ meal: { connect: { id: mealId } } });

const menuWeekNotFound = () =>
  new NotFoundException({ code: 'MENU_WEEK_NOT_FOUND', message: 'Menu week not found.' });

/** `uq_menu_weeks_year_week`: one menu per ISO week. */
const weekTaken = () =>
  new ConflictException({
    code: 'MENU_WEEK_EXISTS',
    message: 'This week already has a menu.',
  });

/** Prisma's unique-constraint violation (P2002). */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Prisma's "no row matched the `where`" (P2025). */
function isNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}
