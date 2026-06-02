import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { CreateMealDto, CreateMenuWeekDto, UpdateFormuleDto, UpdateMealDto } from './dto/catalog-admin.dto';

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
        prepTime: payload.prepTime,
        dietaryTags: payload.dietaryTags ?? [],
        allergens: payload.allergens ?? [],
        ingredients: payload.ingredients ?? [],
        status: (payload.status as never) ?? 'draft',
      },
    });
  }

  updateMeal(id: string, payload: UpdateMealDto) {
    return this.prisma.meal.update({
      where: { id },
      data: {
        ...payload,
        status: payload.status as never,
      },
    });
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
