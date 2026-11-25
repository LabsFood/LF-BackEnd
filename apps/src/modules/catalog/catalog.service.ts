import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { Meal, MealStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { fridgeAlertDaysInForce } from '../platform-settings/fridge-alert';
import { assertIngredientAccess } from '../ingredients/composition';
import {
  assertConsistent,
  assertProfiles,
  assertReheatModes,
  assertWithinLimits,
  checkedLines,
  composeLines,
  composedSave,
  compositionColumns,
  SAFETY_FIELDS,
  storedState,
  toReheatingJson,
  toStepsJson,
  toStorageJson,
  withLegacyAdded,
} from '../dishes/dishes.service';
import { sameAllergenState } from '../dishes/domain/allergens.rules';
import { linkedIds } from '../dishes/domain/classification.rules';
import {
  contentNotOwned,
  offerPending,
  recipeConflict,
  recipeNotReady,
} from '../dishes/domain/content.errors';
import { ReadinessDish } from '../dishes/domain/dishes.rules';
import { publicationProblems } from '../dishes/domain/menus.rules';
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

  /** The console's fridge threshold, for the `FRIDGE_LONG` warning of a meal view. */
  fridgeAlertDays() {
    return fridgeAlertDaysInForce(this.prisma);
  }

  listMeals() {
    return this.prisma.meal.findMany({
      where: LABS_FOOD,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Always an unowned Lab's Food meal; the admin is recorded as its author only.
   * Recettes §6.1: its allergens are computed from the lines like a chef dish's, and
   * the lines are stamped, so a chef who adopts the meal inherits them as they are.
   */
  async createMeal(payload: CreateMealDto, adminUserId: string) {
    assertConsistent(declarationOf(null, payload));
    assertWithinLimits(payload);
    const lines = payload.ingredients && checkedLines(payload.ingredients);
    await assertReheatModes(this.prisma, payload.reheating);
    if (lines) {
      // Recettes §4.10: a Lab's Food recipe links no ingredient private to a chef.
      await assertIngredientAccess(this.prisma, lines, {
        chefProfileId: null,
        previousIds: new Set(),
      });
    }
    await assertProfiles(this.prisma, payload.profiles);
    const composed = await composeLines(this.prisma, null, payload, lines ?? []);
    const data = {
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
      ...compositionColumns(composed),
      // Recettes §4.9: an admin writes the whole form at once, so the save is the
      // check, provided every line is known and its ingredient complete.
      allergensVerifiedAt: composed.state.complete ? new Date() : null,
      calories: payload.calories ?? null,
      difficulty: payload.difficulty ?? null,
      category: payload.category ?? null,
      cookTime: payload.cookTime ?? null,
      steps: payload.steps && toStepsJson(payload.steps),
      equipment: payload.equipment,
      declaredDiets: payload.declaredDiets,
      profiles: payload.profiles,
      seasonsOverride: payload.seasonsOverride,
      reheating: toReheatingJson(payload.reheating),
      storage: toStorageJson(payload.storage),
      isFeatured: payload.isFeatured,
      status: payload.status ?? MealStatus.draft,
    };
    // Recettes §4.11: a Lab's Food meal goes online on the same terms as a chef's,
    // under the socle's full "Prête" check (§6.4).
    if (data.status === MealStatus.published) {
      // Read as the row will be stored: the schema defaults fill what was left out.
      assertPublishable({
        ...data,
        description: data.description ?? null,
        portions: data.portions ?? 4,
        steps: data.steps ?? [],
        declaredDiets: data.declaredDiets ?? [],
        seasonsOverride: data.seasonsOverride ?? [],
      } as unknown as ReadinessDish);
    }
    return this.prisma.meal.create({ data });
  }

  /**
   * The owner filter sits in the `where`, so the check and the write are one
   * statement: no gap in which the row could change hands in between.
   *
   * Recettes §6.1: sending lines or the added allergens composes the meal again, and
   * the admin's save is the check (§4.9). Sent alone, the extras apply to the stored
   * lines. Hand-declared allergens of a row written before are carried as added (R7).
   */
  async updateMeal(id: string, payload: UpdateMealDto, adminUserId: string) {
    assertWithinLimits(payload);
    const lines =
      payload.ingredients != null ? checkedLines(payload.ingredients) : undefined;
    await assertReheatModes(this.prisma, payload.reheating);
    await assertProfiles(this.prisma, payload.profiles);
    let current: Meal | null = null;
    // Ruling R30: the version the admin read; null counts as not sent, as on the chef route.
    const readVersion = payload.lockVersion ?? undefined;
    const publishing = payload.status === MealStatus.published;
    const recomposes =
      lines !== undefined ||
      payload.addedAllergens != null ||
      payload.customAllergens != null;
    if (
      recomposes ||
      touchesDeclaration(payload) ||
      payload.country !== undefined ||
      publishing ||
      readVersion !== undefined
    ) {
      current = await this.prisma.meal.findFirst({ where: { id, ...LABS_FOOD } });
      if (!current) return this.explainMissing(id);
      // A form that read an older version reloads before anything else is checked.
      if (readVersion !== undefined && readVersion !== current.lockVersion) {
        throw recipeConflict(current.lockVersion);
      }
      assertConsistent(declarationOf(current, payload));
      if (publishing && current.offeredToChefProfileId) throw offerPending();
      if (lines) {
        // An entry since deactivated stays on the lines that already had it (§8.1).
        await assertIngredientAccess(this.prisma, lines, {
          chefProfileId: null,
          previousIds: new Set(linkedIds(current.ingredients)),
        });
      }
    }
    const composed = recomposes
      ? await composedSave(this.prisma, current, payload, lines)
      : null;
    // Recettes §7.3, ruling R12: a write of the composition lands only on the
    // `lockVersion` read, and moves it on, as a chef's save does. A propagation and
    // this save then never overwrite each other's lines (`current` is always read
    // when the meal recomposes). Ruling R30: so does any write that sent the
    // version it read, so another tab's save in between answers 409 too.
    const guarded = !!current && (!!composed || readVersion !== undefined);
    const guard = guarded && current ? { lockVersion: current.lockVersion } : {};
    const changes = CatalogService.toMealUpdateData(payload);
    const verification = composed && {
      ...compositionColumns(composed),
      allergensVerifiedAt: composed.state.complete ? new Date() : null,
    };
    // Recettes §4.11 (develop, 11/11): a Lab's Food meal publishes only when its
    // recipe is ready, judged on what the meal will hold after this save.
    if (publishing && current) {
      assertPublishable({
        ...current,
        ...changes,
        ...verification,
      } as unknown as ReadinessDish);
    }
    let updated: Meal;
    try {
      updated = await this.prisma.meal.update({
        where: { id, ...LABS_FOOD, ...guard },
        data: {
          ...changes,
          ...verification,
          ...(guarded && { lockVersion: { increment: 1 } }),
        },
      });
    } catch (error) {
      if (isNotFound(error)) return this.explainMissing(id, 'lockVersion' in guard);
      throw error;
    }
    // Chefs who adopted this suggestion hear about a safety change (§6, PRD), and
    // about computed allergens that moved: compared with the row as the reprise reads it.
    const allergensMoved =
      !!current &&
      !!composed &&
      !sameAllergenState(storedState(withLegacyAdded(current)), composed.state);
    if (current && (allergensMoved || safetyChanged(current, updated))) {
      await this.suggestions.flagCopies(updated, adminUserId);
    }
    return updated;
  }

  /**
   * A write matched nothing: the meal is gone, or it belongs to a batch cooker. A
   * guarded write (`guarded`) that missed a Lab's Food meal still there lost to a
   * save in between, the §7.3 propagation typically: 409 `RECIPE_CONFLICT` with the
   * `lockVersion` to reload, the answer a chef's save gives (Recettes §8.1).
   */
  private async explainMissing(id: string, guarded = false): Promise<never> {
    const row = await this.prisma.meal.findUnique({
      where: { id },
      select: { chefProfileId: true, lockVersion: true },
    });
    if (row && guarded && row.chefProfileId === null) {
      throw recipeConflict(row.lockVersion);
    }
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

    // The lines and the allergens are composed, never mapped here (`compositionColumns`).
    if (payload.name != null) data.name = payload.name;
    if (payload.portions != null) data.portions = payload.portions;
    if (payload.prepTime != null) data.prepTime = payload.prepTime;
    if (payload.dietaryTags != null) data.dietaryTags = payload.dietaryTags;
    if (payload.customDiets != null) data.customDiets = payload.customDiets;
    if (payload.steps != null) data.steps = toStepsJson(payload.steps);
    if (payload.equipment != null) data.equipment = payload.equipment;
    if (payload.declaredDiets != null) data.declaredDiets = payload.declaredDiets;
    if (payload.profiles != null) data.profiles = payload.profiles;
    if (payload.seasonsOverride != null) data.seasonsOverride = payload.seasonsOverride;
    if (payload.isFeatured != null) data.isFeatured = payload.isFeatured;
    if (payload.status != null) data.status = payload.status;

    // A new recipe version; bookings keep the one they pinned (FLOW-02 §9.2).
    // Reheating is not part of it (Recettes §4.6): it applies as soon as saved.
    const recipeTouched = [
      payload.ingredients,
      payload.steps,
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

/**
 * The free-text and diet declaration once `payload` is applied to `current`. The
 * regulated allergens are computed (Recettes §6.1), so only the free text is checked.
 */
function declarationOf(current: Meal | null, payload: UpdateMealDto) {
  return {
    allergens: [],
    allergensNone: false,
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
    payload.addedAllergens,
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

/** The readiness rule chefs publish under (Recettes §4.11), for the admin's meals. */
function assertPublishable(meal: ReadinessDish): void {
  const problems = publicationProblems(meal);
  if (problems.length) throw recipeNotReady(problems);
}
