import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { Meal, MealDifficulty, MealStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { classificationOf } from '../ingredients/ingredients.service';
import {
  recipeProfilesInForce,
  reheatModesInForce,
} from '../platform-settings/recipe-lists';
import { ChefContentService } from './chef-content.service';
import { toDishView } from './dishes.views';
import { recipeDocumentOf, recipeFilename, renderRecipePdf } from './recipe-document';
import { limitReached, recipeNotReady, validationFailed } from './domain/content.errors';
import {
  CLEARED_MODERATION,
  nextReviewReason,
  reviewFields,
} from './domain/moderation.rules';
import {
  declarationProblems,
  PublishableDish,
  publishProblems,
  readiness,
} from './domain/dishes.rules';
import { publicationProblems } from './domain/menus.rules';
import {
  ingredientsChanged,
  readSteps,
  recipeLimitBreach,
  sameContent,
} from './domain/recipes.rules';
import {
  CreateDishDto,
  IngredientDto,
  RecipeDto,
  ReheatingDto,
  StepDto,
  StorageDto,
  UpdateDishDto,
} from './dto/dish.dto';

/** A batch cooker's own dishes (FLOW-02 §3.1–§3.3). */
@Injectable()
export class DishesService {
  private readonly logger = new Logger(DishesService.name);

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

  /** Recettes §7: the recipe sheet as a PDF, watermarked, for the chef's own dish. */
  async recipePdf(clerkUserId: string, id: string) {
    const chef = await this.access.chef(clerkUserId);
    const dish = await this.access.readableDish(chef, id);
    const body = await renderRecipePdf(
      recipeDocumentOf(dish, await reheatModesInForce(this.prisma)),
    );
    this.logger.log({ event: 'dish.recipe_pdf_made', dishId: id, bytes: body.length });
    return { filename: recipeFilename(dish.name, dish.recipeVersion), body };
  }

  /** Always created as a `draft`, owned and authored by the chef. */
  async create(clerkUserId: string, payload: CreateDishDto) {
    const chef = await this.access.chef(clerkUserId);
    this.access.assertVerified(chef);
    assertConsistent(declarationOf(null, payload));
    if (payload.recipe) assertWithinLimits(payload.recipe);
    await assertReheatModes(this.prisma, payload.recipe?.reheating);
    await assertCatalogIngredients(this.prisma, payload.recipe?.ingredients);
    await assertProfiles(this.prisma, payload.profiles);

    const write = toMealWrite(payload);
    const dish = await this.prisma.meal.create({
      data: {
        ...write,
        ...(write.ingredients !== undefined && {
          classification: await classificationOf(this.prisma, write.ingredients),
        }),
        name: payload.name,
        prepTime: payload.prepMinutes,
        chefProfileId: chef.id,
        createdByUserId: chef.userId,
        status: MealStatus.draft,
        // R6: no version yet; the first one is made once the recipe is "Prête".
        versionPending: payload.recipe != null,
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
    if (payload.recipe) assertWithinLimits(payload.recipe);
    await assertReheatModes(this.prisma, payload.recipe?.reheating);
    await assertCatalogIngredients(this.prisma, payload.recipe?.ingredients);
    await assertProfiles(this.prisma, payload.profiles);
    if (current.status === MealStatus.published) {
      assertPublishable({
        name: payload.name ?? current.name,
        portions: payload.portions ?? current.portions,
        allergens: declaration.allergens,
        allergensNone: declaration.allergensNone,
      });
    }

    // Recettes §4.9: a new, removed or renamed ingredient asks the chef to verify
    // the allergens again. Until then the dish stays published but cannot be booked.
    const reverify =
      !!payload.recipe &&
      current.allergensVerifiedAt !== null &&
      ingredientsChanged(current.ingredients, payload.recipe.ingredients);

    const write = toMealWrite(payload);
    // R6: saving never makes a version by itself (a draft is saved as it is typed);
    // the change waits until the recipe is "Prête" again, see `cutVersion`.
    const changed = versionContentChanged(current, write);

    const dish = await this.prisma
      .$transaction(async (tx) => {
        const row = await tx.meal.update({
          where: { id, chefProfileId: chef.id },
          data: {
            ...write,
            ...(write.ingredients !== undefined && {
              classification: await classificationOf(this.prisma, write.ingredients),
            }),
            ...(reverify && { allergensVerifiedAt: null }),
            ...(changed && { versionPending: true }),
            // The chef answered the change to the suggestion they adopted (§6).
            ...(touchesSafety(payload) && { sourceChangedAt: null }),
            // §3.2: allergens, diets or country changed on a public dish: admins look
            // again. Also on a draft they had already reviewed, so unpublishing, editing
            // and republishing cannot skip the queue (it lists public content only).
            ...(touchesSafety(payload) &&
              (current.status === MealStatus.published || current.reviewedAt) &&
              reviewFields(current, nextReviewReason(current, 'edited'), new Date())),
          },
        });
        return readiness(row).ready ? this.cutVersion(tx, row) : row;
      })
      .catch(goneMeanwhile('Dish'));
    if (reverify) {
      this.logger.log({ event: 'dish.allergens_verification_cleared', dishId: id });
    }
    return toDishView(dish);
  }

  /**
   * Recettes §4.9: the chef confirms the allergens declared match the ingredients.
   * Needed to be "Prête", and for a dish to be booked.
   */
  async confirmAllergens(clerkUserId: string, id: string) {
    const chef = await this.access.chef(clerkUserId);
    this.access.assertVerified(chef);
    const dish = await this.access.writableDish(chef, id);
    if (dish.allergens.length === 0 && !dish.allergensNone) {
      throw new UnprocessableEntityException({
        code: 'ALLERGENS_REQUIRED',
        message:
          'Declare the allergens first: list them, or confirm the dish contains none ' +
          'of the 14 (`allergensNone: true`).',
      });
    }
    // The changes the chef just verified become a version even if the recipe is not
    // "Prête" yet: a booking must never cook ingredients other than the ones whose
    // allergens were confirmed.
    const confirmed = await this.prisma
      .$transaction(async (tx) => {
        const row = await tx.meal.update({
          where: { id, chefProfileId: chef.id },
          data: { allergensVerifiedAt: new Date() },
        });
        return this.cutVersion(tx, row);
      })
      .catch(goneMeanwhile('Dish'));
    this.logger.log({ event: 'dish.allergens_confirmed', dishId: id });
    return toDishView(confirmed);
  }

  /**
   * R6: the recipe as it stands becomes a version, its content kept for the
   * bookings that pin it. Nothing to do without a change since the last one. The
   * first version keeps its number when no booking ever kept one.
   */
  private async cutVersion(tx: Prisma.TransactionClient, row: Meal): Promise<Meal> {
    if (!row.versionPending) return row;
    const kept = await tx.mealRecipeVersion.findUnique({
      where: { mealId_version: { mealId: row.id, version: row.recipeVersion } },
      select: { id: true },
    });
    const version = kept ? row.recipeVersion + 1 : row.recipeVersion;
    const cut = await tx.meal.update({
      where: { id: row.id },
      data: { ...(kept && { recipeVersion: version }), versionPending: false },
    });
    await tx.mealRecipeVersion.create({
      data: {
        mealId: row.id,
        version,
        portions: cut.portions,
        ingredients: cut.ingredients ?? [],
        steps: cut.steps ?? [],
        reheating: cut.reheating ?? Prisma.DbNull,
        storage: cut.storage ?? Prisma.DbNull,
      },
    });
    this.logger.log({ event: 'dish.version_made', dishId: row.id, version });
    return cut;
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
   * §3.3 and Recettes §4.11. The chef's own standing is checked first
   * (`CHEF_NOT_VERIFIED`), then the dish: "Prête" plus what publishing adds, every
   * failing point at once (`RECIPE_NOT_READY`). Publishing an already published
   * dish changes nothing.
   */
  async publish(clerkUserId: string, id: string) {
    const chef = await this.access.chef(clerkUserId);
    await this.access.assertCanPublish(chef);
    const dish = await this.access.writableDish(chef, id);
    if (dish.status === MealStatus.published) return toDishView(dish);

    const problems = publicationProblems(dish);
    if (problems.length) throw recipeNotReady(problems);
    // §2: a suspended dish the chef corrected comes back first in the review queue.
    const republished = dish.status === MealStatus.suspended;
    const now = new Date();
    const published = await this.prisma
      .$transaction(async (tx) => {
        const row = await tx.meal.update({
          // The status read above is part of the write: if an admin suspended or
          // reinstated it meanwhile, this matches nothing instead of overwriting that.
          where: { id, chefProfileId: chef.id, status: dish.status },
          data: {
            status: MealStatus.published,
            publishedAt: now,
            ...reviewFields(
              dish,
              nextReviewReason(
                dish,
                republished ? 'republished-after-suspension' : 'published',
              ),
              now,
            ),
            ...(republished && CLEARED_MODERATION),
          },
        });
        return this.cutVersion(tx, row);
      })
      .catch(changedMeanwhile);
    return toDishView(published);
  }

  /** Back to `draft`: off the public site, still the chef's. */
  async unpublish(clerkUserId: string, id: string) {
    const chef = await this.access.chef(clerkUserId);
    this.access.assertVerified(chef);
    const dish = await this.access.writableDish(chef, id);
    if (dish.status !== MealStatus.published) return toDishView(dish);

    // Only from `published`: a suspension made meanwhile is never overwritten.
    const drafted = await this.prisma.meal
      .update({
        where: { id, chefProfileId: chef.id, status: MealStatus.published },
        data: { status: MealStatus.draft },
      })
      .catch(changedMeanwhile);
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

/**
 * A status change matched nothing: the content was changed or deleted between the
 * read and the write (typically an admin decision). Reload rather than overwrite.
 */
export function changedMeanwhile(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
    throw new ConflictException({
      code: 'CHANGED_MEANWHILE',
      message: 'This changed meanwhile, possibly by an admin. Reload it and try again.',
    });
  }
  throw error;
}

/**
 * R6: a change to what a version keeps (portions, ingredients, steps, storage).
 * Reheating is not part of it (§4.6), nor anything the client sees on the shop.
 */
function versionContentChanged(current: Meal, write: MealColumns): boolean {
  const json = (value: unknown) => (value === Prisma.DbNull ? null : value);
  return (
    (write.portions !== undefined && write.portions !== current.portions) ||
    (write.ingredients !== undefined &&
      !sameContent(asWritten(current.ingredients), write.ingredients)) ||
    (write.steps !== undefined && !sameContent(readSteps(current.steps), write.steps)) ||
    (write.storage !== undefined &&
      !sameContent(
        current.storage && { container: null, ...(current.storage as object) },
        json(write.storage),
      ))
  );
}

/**
 * Stored lines with the defaults a write gives them, so a line saved before a
 * field existed is not taken for a change.
 */
const asWritten = (ingredients: unknown) =>
  (Array.isArray(ingredients) ? ingredients : []).map((line) => ({
    link: null,
    toVerify: false,
    fixedQuantity: false,
    catalogIngredientId: null,
    ...(line as object),
  }));

/** Throws the problems a published dish must never have, if any. */
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

/**
 * The fields §3.2 treats as review-worthy: allergens, diets, country. A change to
 * one of them on a suggestion flags every copy; on a copy, it answers that flag.
 */
export const SAFETY_FIELDS = [
  'allergens',
  'allergensNone',
  'customAllergens',
  'dietaryTags',
  'customDiets',
  'country',
] as const;

const touchesSafety = (payload: UpdateDishDto) =>
  [
    payload.allergens,
    payload.allergensNone,
    payload.customAllergens,
    payload.diets,
    payload.customDiets,
    payload.country,
  ].some((value) => value !== undefined);

export function assertConsistent(state: ReturnType<typeof declarationOf>): void {
  const problems = declarationProblems(state);
  if (problems.length) throw validationFailed(problems.join(' '), { problems });
}

/** Recettes §4.8: each profile from the list in force. Shared with the admin routes. */
export async function assertProfiles(
  db: Pick<PrismaService, 'platformSetting'>,
  profiles?: string[] | null,
): Promise<void> {
  if (!profiles?.length) return;
  const known = new Set((await recipeProfilesInForce(db)).map((p) => p.code));
  const unknown = profiles.filter((code) => !known.has(code));
  if (unknown.length) {
    throw validationFailed(
      `Not a recipe profile: ${unknown.join(', ')}. See GET /referentials/recipe-profiles.`,
    );
  }
}

/** Recettes §4.6: each mode from the list in force. Shared with the admin routes. */
export async function assertReheatModes(
  db: Pick<PrismaService, 'platformSetting'>,
  reheating?: ReheatingDto | null,
): Promise<void> {
  const wanted = reheating ? modesOf(reheating) : [];
  if (wanted.length === 0) return;
  const known = new Set((await reheatModesInForce(db)).map((m) => m.code));
  const unknown = wanted.filter((code) => !known.has(code));
  if (unknown.length) {
    throw validationFailed(
      `Not a reheating mode: ${unknown.join(', ')}. See GET /referentials/reheat-modes.`,
    );
  }
}

/** `modes`, or the one `mode` sent before modes were a list. */
const modesOf = (reheating: ReheatingDto) =>
  reheating.modes ?? (reheating.mode ? [reheating.mode] : []);

/** Recettes BLK-28: 422 `LIMIT_REACHED` past a cap. Shared with the admin routes. */
export function assertWithinLimits(recipe: {
  ingredients?: unknown[] | null;
  steps?: { text: string }[] | null;
}): void {
  const breach = recipeLimitBreach(
    recipe.ingredients?.length ?? 0,
    (recipe.steps ?? []).map((step) => step.text),
  );
  if (breach) throw limitReached(breach.limit, breach.max);
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
    | 'equipment'
    | 'declaredDiets'
    | 'profiles'
    | 'personalTags'
    | 'seasonsOverride'
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
  if (payload.equipment != null) data.equipment = payload.equipment;
  if (payload.declaredDiets != null) data.declaredDiets = payload.declaredDiets;
  if (payload.profiles != null) data.profiles = payload.profiles;
  if (payload.personalTags != null) data.personalTags = payload.personalTags;
  if (payload.seasonsOverride != null) {
    data.seasonsOverride = [...new Set(payload.seasonsOverride)].sort((a, b) => a - b);
  }
  if (payload.recipe != null) Object.assign(data, toRecipeWrite(payload.recipe));

  return data;
}

function toRecipeWrite(recipe: RecipeDto) {
  return {
    ingredients: toIngredientsJson(recipe.ingredients),
    steps: toStepsJson(recipe.steps),
    reheating: toReheatingJson(recipe.reheating),
    storage: toStorageJson(recipe.storage),
  };
}

/*
 * Plain JSON, so nothing but the documented keys is ever stored. Shared with the
 * Lab's Food admin routes, which write the same columns.
 */

export const toIngredientsJson = (ingredients: IngredientDto[]) =>
  ingredients.map(
    ({ name, qty, unit, aisle, link, toVerify, fixedQuantity, catalogIngredientId }) => ({
      name,
      qty,
      unit,
      aisle,
      link: link ?? null,
      toVerify: toVerify ?? false,
      fixedQuantity: fixedQuantity ?? false,
      catalogIngredientId: catalogIngredientId ?? null,
    }),
  );

/** Recettes §4.10: a line may only point to an entry of the common list. */
export async function assertCatalogIngredients(
  db: Pick<PrismaService, 'catalogIngredient'>,
  ingredients?: IngredientDto[] | null,
): Promise<void> {
  const ids = [
    ...new Set((ingredients ?? []).flatMap((i) => i.catalogIngredientId ?? [])),
  ];
  if (ids.length === 0) return;
  const found = await db.catalogIngredient.count({ where: { id: { in: ids } } });
  if (found !== ids.length) {
    throw validationFailed(
      'A line points to an ingredient that is not in the common list. See GET /ingredients.',
    );
  }
}

/** Numbered by position, `type` and `durationMinutes` null when not given. */
export const toStepsJson = (steps: StepDto[]) => readSteps(steps);

/** `mode` repeats the first of `modes`, for readers written before the list. */
export const toReheatingJson = (reheating?: ReheatingDto | null) => {
  if (!reheating) return Prisma.DbNull;
  const modes = modesOf(reheating);
  return {
    modes,
    mode: modes[0] ?? null,
    temperature: reheating.temperature ?? null,
    minutes: reheating.minutes ?? null,
    note: reheating.note ?? null,
    container: reheating.container ?? null,
  };
};

export const toStorageJson = (storage?: StorageDto | null) =>
  storage
    ? {
        method: storage.method,
        days: storage.days,
        container: storage.container ?? null,
      }
    : Prisma.DbNull;
