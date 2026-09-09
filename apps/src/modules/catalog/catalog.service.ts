import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { MealStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateMealDto,
  CreateMenuWeekDto,
  UpdateFormuleDto,
  UpdateMealDto,
} from './dto/catalog-admin.dto';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrentPublishedMenu(): Promise<{
    menuWeek: unknown;
    meals: unknown[];
  } | null> {
    const now = new Date();
    const week = await this.prisma.menuWeek.findFirst({
      where: { publishedAt: { not: null, lte: now } },
      orderBy: [{ year: 'desc' }, { weekNumber: 'desc' }],
      include: { meals: { include: { meal: true } } },
    });
    if (!week) {
      return null;
    }

    return {
      menuWeek: week,
      meals: week.meals.map((entry) => entry.meal),
    };
  }

  listMeals() {
    return this.prisma.meal.findMany({ orderBy: { createdAt: 'desc' } });
  }

  createMeal(payload: CreateMealDto) {
    return this.prisma.meal.create({
      data: {
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
        allergens: payload.allergens ?? [],
        calories: payload.calories ?? null,
        difficulty: payload.difficulty ?? null,
        ingredients: payload.ingredients ?? [],
        steps: payload.steps,
        isFeatured: payload.isFeatured,
        status: payload.status ?? MealStatus.draft,
      },
    });
  }

  updateMeal(id: string, payload: UpdateMealDto) {
    return this.prisma.meal.update({
      where: { id },
      data: CatalogService.toMealUpdateData(payload),
    });
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

    if (payload.name != null) data.name = payload.name;
    if (payload.portions != null) data.portions = payload.portions;
    if (payload.prepTime != null) data.prepTime = payload.prepTime;
    if (payload.dietaryTags != null) data.dietaryTags = payload.dietaryTags;
    if (payload.allergens != null) data.allergens = payload.allergens;
    if (payload.ingredients != null) data.ingredients = payload.ingredients;
    if (payload.steps != null) data.steps = payload.steps;
    if (payload.isFeatured != null) data.isFeatured = payload.isFeatured;
    if (payload.status != null) data.status = payload.status;

    return data;
  }

  async deleteMeal(id: string): Promise<void> {
    try {
      await this.prisma.meal.delete({ where: { id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        // Record to delete does not exist.
        if (error.code === 'P2025') {
          throw new NotFoundException('Meal not found.');
        }
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
      include: { meals: { include: { meal: true } } },
    });
  }

  async createMenuWeek(payload: CreateMenuWeekDto) {
    return this.prisma.menuWeek.create({
      data: {
        year: payload.year,
        weekNumber: payload.weekNumber,
        publishedAt: null,
        meals: payload.mealIds?.length
          ? {
              create: payload.mealIds.map((mealId) => ({
                meal: { connect: { id: mealId } },
              })),
            }
          : undefined,
      },
      include: { meals: { include: { meal: true } } },
    });
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
