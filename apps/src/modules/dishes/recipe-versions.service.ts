import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { entriesFor } from '../ingredients/composition';
import { ChefContentService } from './chef-content.service';
import { DishesService } from './dishes.service';
import { LineInput, readLines, toLineInput } from './domain/recipe-lines.rules';
import { readSteps } from './domain/recipes.rules';
import type { UpdateDishDto } from './dto/dish.dto';

/**
 * Recettes §8.2: a dish's frozen versions. The chef lists them, reads one, and
 * restores one into the dish. History is never erased: a restore is a normal save.
 */
@Injectable()
export class RecipeVersionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ChefContentService,
    private readonly dishes: DishesService,
  ) {}

  /** Newest first, with how many bookings pin each version. */
  async list(clerkUserId: string, dishId: string) {
    const chef = await this.access.chef(clerkUserId);
    const dish = await this.access.readableDish(chef, dishId);
    const rows = await this.prisma.mealRecipeVersion.findMany({
      where: { mealId: dish.id },
      orderBy: { version: 'desc' },
      include: { _count: { select: { bookingMeals: true } } },
    });
    return rows.map((row) => ({
      version: row.version,
      createdAt: row.createdAt,
      bookings: row._count.bookingMeals,
      current: row.version === dish.recipeVersion,
    }));
  }

  /**
   * One version's content. R33: its lines and steps are served as the rules read
   * them, as `restore` reads them, every stamp kept: a version cut in lot 2 can hold
   * string steps and legacy units. The version itself is never written.
   */
  async get(clerkUserId: string, dishId: string, version: number) {
    const chef = await this.access.chef(clerkUserId);
    const dish = await this.access.readableDish(chef, dishId);
    const row = await this.read(dish.id, version);
    return {
      version: row.version,
      createdAt: row.createdAt,
      portions: row.portions,
      ingredients: readLines(row.ingredients).map((line) => ({ ...line })),
      steps: readSteps(row.steps),
      reheating: row.reheating,
      storage: row.storage,
    };
  }

  /**
   * Recettes §8.2: copies the version into the dish through the normal save, so
   * recomputation, re-verification, `versionPending` and a new version when the
   * recipe is "Prête" all apply. A line linked to an entry merged since then is
   * repointed to its target; one whose entry is gone becomes a line to verify.
   */
  async restore(
    clerkUserId: string,
    dishId: string,
    version: number,
    lockVersion?: number,
  ) {
    const chef = await this.access.chef(clerkUserId);
    const dish = await this.access.readableDish(chef, dishId);
    const row = await this.read(dish.id, version);

    const lines = (Array.isArray(row.ingredients) ? row.ingredients : []).map(
      toLineInput,
    );
    const entries = await entriesFor(
      this.prisma,
      lines.flatMap((line) => line.catalogIngredientId ?? []),
    );
    const ingredients = lines.map((line): LineInput => {
      const id = line.catalogIngredientId;
      if (!id) return line;
      const entry = entries.get(id);
      if (entry) return { ...line, catalogIngredientId: entry.id };
      return {
        ...line,
        catalogIngredientId: null,
        toVerify: true,
        rawText:
          line.rawText ||
          [line.qty, line.unit, line.name]
            .filter((part) => part !== null && part !== '')
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim(),
      };
    });

    // Storage and reheating may predate newer fields: passed as stored, the
    // readiness check says what is missing.
    const payload = {
      portions: row.portions,
      recipe: {
        ingredients,
        steps: readSteps(row.steps),
        reheating: row.reheating,
        storage: row.storage,
      },
      ...(lockVersion !== undefined && { lockVersion }),
    } as unknown as UpdateDishDto;
    // §8.1: an entry deactivated since the version was made stays on its line.
    const allowedIds = ingredients.flatMap((line) => line.catalogIngredientId ?? []);
    return this.dishes.update(clerkUserId, dish.id, payload, { allowedIds });
  }

  private async read(mealId: string, version: number) {
    const row = await this.prisma.mealRecipeVersion.findUnique({
      where: { mealId_version: { mealId, version } },
    });
    if (!row) throw new NotFoundException('Recipe version not found.');
    return row;
  }
}
