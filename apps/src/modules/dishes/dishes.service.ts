import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { Meal, MealDifficulty, MealStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ChefContentService } from './chef-content.service';
import { toDishView } from './dishes.views';
import { validationFailed } from './domain/content.errors';
import {
  declarationProblems,
  PublishableDish,
  publishProblems,
} from './domain/dishes.rules';
import {
  CreateDishDto,
  IngredientDto,
  RecipeDto,
  ReheatingDto,
  StorageDto,
  UpdateDishDto,
} from './dto/dish.dto';

/** A batch cooker's own dishes (FLOW-02 §3.1–§3.3). */
@Injectable()
export class DishesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ChefContentService,
  ) {}

  async list(clerkUserId: string) {
    const chef = await this.access.chef(clerkUserId);
    const dishes = await this.prisma.meal.findMany({
      where: { chefProfileId: chef.id },
      orderBy: { updatedAt: 'desc' },
    });
    return dishes.map(toDishView);
  }

  async get(clerkUserId: string, id: string) {
    const chef = await this.access.chef(clerkUserId);
    return toDishView(await this.access.readableDish(chef, id));
  }

  /** Always created as a `draft`, owned and authored by the chef. */
  async create(clerkUserId: string, payload: CreateDishDto) {
    const chef = await this.access.chef(clerkUserId);
    this.access.assertVerified(chef);
    assertConsistent(declarationOf(null, payload));

    const dish = await this.prisma.meal.create({
      data: {
        ...toMealWrite(payload),
        name: payload.name,
        prepTime: payload.prepMinutes,
        chefProfileId: chef.id,
        createdByUserId: chef.userId,
        status: MealStatus.draft,
      },
    });
    return toDishView(dish);
  }

  /**
   * §3.2: editing a published dish keeps it published, so the edit must leave it
   * publishable: clearing its country or its allergen declaration is refused
   * until the chef unpublishes it.
   */
  async update(clerkUserId: string, id: string, payload: UpdateDishDto) {
    const chef = await this.access.chef(clerkUserId);
    this.access.assertVerified(chef);
    const current = await this.access.writableDish(chef, id);
    const declaration = declarationOf(current, payload);
    assertConsistent(declaration);
    if (current.status === MealStatus.published) {
      assertPublishable({
        name: payload.name ?? current.name,
        country: payload.country === undefined ? current.country : payload.country,
        portions: payload.portions ?? current.portions,
        allergens: declaration.allergens,
        allergensNone: declaration.allergensNone,
      });
    }

    const dish = await this.prisma.meal
      .update({ where: { id, chefProfileId: chef.id }, data: toMealWrite(payload) })
      .catch(goneMeanwhile('Dish'));
    return toDishView(dish);
  }

  async remove(clerkUserId: string, id: string): Promise<void> {
    const chef = await this.access.chef(clerkUserId);
    this.access.assertVerified(chef);
    await this.access.writableDish(chef, id);
    try {
      await this.prisma.meal
        .delete({ where: { id, chefProfileId: chef.id } })
        .catch(goneMeanwhile('Dish'));
    } catch (error) {
      // booking_meals is RESTRICT: a dish that was booked stays for the booking.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new ConflictException(
          'This dish was booked, so it cannot be deleted. Unpublish it instead.',
        );
      }
      throw error;
    }
  }

  /**
   * §3.3. The chef's own standing is checked first (`CHEF_NOT_VERIFIED`), then
   * the dish; every failing check is returned at once. Publishing an already
   * published dish changes nothing.
   */
  async publish(clerkUserId: string, id: string) {
    const chef = await this.access.chef(clerkUserId);
    await this.access.assertCanPublish(chef);
    const dish = await this.access.writableDish(chef, id);
    if (dish.status === MealStatus.published) return toDishView(dish);

    assertPublishable(dish);
    const published = await this.prisma.meal.update({
      where: { id, chefProfileId: chef.id },
      data: { status: MealStatus.published, publishedAt: new Date() },
    });
    return toDishView(published);
  }

  /** Back to `draft`: off the public site, still the chef's. */
  async unpublish(clerkUserId: string, id: string) {
    const chef = await this.access.chef(clerkUserId);
    this.access.assertVerified(chef);
    const dish = await this.access.writableDish(chef, id);
    if (dish.status !== MealStatus.published) return toDishView(dish);

    const drafted = await this.prisma.meal.update({
      where: { id, chefProfileId: chef.id },
      data: { status: MealStatus.draft },
    });
    return toDishView(drafted);
  }
}

/**
 * The row was found a moment ago but the write matched nothing: another request
 * deleted it in between. A 404, not a server error.
 */
export const goneMeanwhile =
  (what: 'Dish' | 'Menu') =>
  (error: unknown): never => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      throw new NotFoundException(`${what} not found.`);
    }
    throw error;
  };

/** Throws the §3.3 problems of one dish, if any. Shared with menu publication. */
export function assertPublishable(dish: PublishableDish): void {
  const problems = publishProblems(dish);
  if (problems.length) {
    throw new UnprocessableEntityException({
      code: problems[0].code,
      message: 'This dish cannot be published yet.',
      problems,
    });
  }
}

/** The declaration as it will be once `payload` is applied to `current`. */
function declarationOf(current: Meal | null, payload: UpdateDishDto) {
  return {
    allergens: payload.allergens ?? current?.allergens ?? [],
    allergensNone: payload.allergensNone ?? current?.allergensNone ?? false,
    customAllergens: payload.customAllergens ?? current?.customAllergens ?? [],
    diets: payload.diets ?? current?.dietaryTags ?? [],
    customDiets: payload.customDiets ?? current?.customDiets ?? [],
  };
}

export function assertConsistent(state: ReturnType<typeof declarationOf>): void {
  const problems = declarationProblems(state);
  if (problems.length) throw validationFailed(problems.join(' '), { problems });
}

/**
 * The `meals` columns a dish write may set, as plain values: valid on a create and
 * on an update alike. Ownership, authorship and status are not among them.
 */
type MealColumns = Partial<
  Pick<
    Prisma.MealUncheckedCreateInput,
    | 'name'
    | 'description'
    | 'country'
    | 'category'
    | 'portions'
    | 'prepTime'
    | 'cookTime'
    | 'difficulty'
    | 'dietaryTags'
    | 'customDiets'
    | 'allergens'
    | 'allergensNone'
    | 'customAllergens'
    | 'ingredients'
    | 'steps'
    | 'reheating'
    | 'storage'
  >
>;

/**
 * Maps the wire fields onto `meals` columns. Nullable columns accept `null` to be
 * cleared; the others ignore it (`@IsOptional()` lets `null` through validation).
 * A `recipe` is replaced as a whole.
 */
function toMealWrite(payload: UpdateDishDto): MealColumns {
  const data: MealColumns = {};

  if (payload.description !== undefined) data.description = payload.description;
  if (payload.country !== undefined) data.country = payload.country;
  if (payload.category !== undefined) data.category = payload.category;
  if (payload.cookMinutes !== undefined) data.cookTime = payload.cookMinutes;
  if (payload.difficulty !== undefined) {
    data.difficulty = payload.difficulty as MealDifficulty | null;
  }

  if (payload.name != null) data.name = payload.name;
  if (payload.portions != null) data.portions = payload.portions;
  if (payload.prepMinutes != null) data.prepTime = payload.prepMinutes;
  if (payload.diets != null) data.dietaryTags = payload.diets;
  if (payload.customDiets != null) data.customDiets = payload.customDiets;
  if (payload.allergens != null) data.allergens = payload.allergens;
  if (payload.allergensNone != null) data.allergensNone = payload.allergensNone;
  if (payload.customAllergens != null) data.customAllergens = payload.customAllergens;
  if (payload.recipe != null) Object.assign(data, toRecipeWrite(payload.recipe));

  return data;
}

function toRecipeWrite(recipe: RecipeDto) {
  return {
    ingredients: toIngredientsJson(recipe.ingredients),
    steps: recipe.steps,
    reheating: toReheatingJson(recipe.reheating),
    storage: toStorageJson(recipe.storage),
  };
}

/*
 * Plain JSON, so nothing but the documented keys is ever stored. Shared with the
 * Lab's Food admin routes, which write the same columns.
 */

export const toIngredientsJson = (ingredients: IngredientDto[]) =>
  ingredients.map(({ name, qty, unit, aisle }) => ({ name, qty, unit, aisle }));

export const toReheatingJson = (reheating?: ReheatingDto | null) =>
  reheating
    ? {
        mode: reheating.mode,
        temperature: reheating.temperature ?? null,
        minutes: reheating.minutes,
        note: reheating.note ?? null,
      }
    : Prisma.DbNull;

export const toStorageJson = (storage?: StorageDto | null) =>
  storage
    ? {
        method: storage.method,
        days: storage.days,
        container: storage.container ?? null,
      }
    : Prisma.DbNull;
