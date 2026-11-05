import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { Meal, MealDifficulty, MealStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  assertIngredientAccess,
  compositionOf,
  LineToStamp,
} from '../ingredients/composition';
import {
  recipeProfilesInForce,
  reheatModesInForce,
} from '../platform-settings/recipe-lists';
import { ChefContentService } from './chef-content.service';
import { toDishView } from './dishes.views';
import { recipeDocumentOf, recipeFilename, renderRecipePdf } from './recipe-document';
import {
  allergenStateOf,
  inAnnexOrder,
  legacyDeclaredAllergens,
  sameAllergenState,
} from './domain/allergens.rules';
import { linkedIds } from './domain/classification.rules';
import {
  duplicateIngredientLine,
  ingredientNotLinked,
  limitReached,
  recipeConflict,
  recipeNotReady,
  validationFailed,
} from './domain/content.errors';
import {
  CLEARED_MODERATION,
  nextReviewReason,
  reviewFields,
} from './domain/moderation.rules';
import {
  ALLERGEN_CODES,
  DeclarationState,
  declarationProblems,
  PublishableDish,
  publishProblems,
  readiness,
} from './domain/dishes.rules';
import { publicationProblems } from './domain/menus.rules';
import {
  duplicateLines,
  lineInputProblems,
  readLines,
  reverifyNeeded,
  SafetySnapshot,
  StoredLine,
} from './domain/recipe-lines.rules';
import { readSteps, recipeLimitBreach, sameContent } from './domain/recipes.rules';
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

  /**
   * Always created as a `draft`, owned and authored by the chef. Its allergens are
   * computed from the lines (Recettes §6.1); its `lockVersion` starts at 0.
   */
  async create(clerkUserId: string, payload: CreateDishDto) {
    const chef = await this.access.chef(clerkUserId);
    this.access.assertVerified(chef);
    assertConsistent(declarationOf(null, payload));
    if (payload.recipe) assertWithinLimits(payload.recipe);
    const lines = payload.recipe && checkedLines(payload.recipe.ingredients);
    await assertReheatModes(this.prisma, payload.recipe?.reheating);
    if (lines) {
      // Recettes §8.1: a new dish has no line yet, so no inactive entry is kept for it.
      await assertIngredientAccess(this.prisma, lines, {
        chefProfileId: chef.id,
        previousIds: new Set(),
      });
    }
    await assertProfiles(this.prisma, payload.profiles);

    const composed = await composedSave(this.prisma, null, payload, lines);
    const dish = await this.prisma.meal.create({
      data: {
        ...toMealWrite(payload),
        ...(composed && compositionColumns(composed)),
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
   * §3.2: editing a published dish keeps it published, so the edit must leave it a
   * name and portions. A recipe left incomplete is still saved: the dish stays
   * published but cannot be booked until its allergens are confirmed again
   * (Recettes §6.5). Recettes §8.1: the write lands only on the `lockVersion` read,
   * so two screens, or a screen and the §7.3 propagation, never overwrite each other.
   */
  async update(clerkUserId: string, id: string, payload: UpdateDishDto) {
    const chef = await this.access.chef(clerkUserId);
    this.access.assertVerified(chef);
    const current = await this.access.writableDish(chef, id);
    // A screen that read an older version reloads before anything else is checked.
    if (payload.lockVersion != null && payload.lockVersion !== current.lockVersion) {
      throw recipeConflict(current.lockVersion);
    }
    assertConsistent(declarationOf(current, payload));
    if (payload.recipe) assertWithinLimits(payload.recipe);
    const lines = payload.recipe && checkedLines(payload.recipe.ingredients);
    await assertReheatModes(this.prisma, payload.recipe?.reheating);
    if (lines) {
      // An entry since deactivated stays on the lines that already had it (§8.1).
      await assertIngredientAccess(this.prisma, lines, {
        chefProfileId: chef.id,
        previousIds: new Set(linkedIds(current.ingredients)),
      });
    }
    await assertProfiles(this.prisma, payload.profiles);
    if (current.status === MealStatus.published) {
      assertPublishable({
        name: payload.name ?? current.name,
        portions: payload.portions ?? current.portions,
      });
    }

    const composed = await composedSave(this.prisma, current, payload, lines);
    const write = {
      ...toMealWrite(payload),
      ...(composed && compositionColumns(composed)),
    };
    // Compared as the reprise reads it (§9, R7): hand-declared allergens count as added,
    // so carrying them over is no change by itself.
    const before = withLegacyAdded(current);
    // Recettes §6.5: a change to what the dish contains, or to its allergens, asks the
    // chef to verify them again. Until then the dish stays published but cannot be booked.
    // Cleared whatever was read: a confirmation made since the read does not move
    // `lockVersion`, so it never stops this write (race A).
    const reverify =
      !!composed && reverifyNeeded(storedSnapshot(before), composedSnapshot(composed));
    // §3.2: computed allergens that change are as review-worthy as the ones sent.
    const safety =
      touchesSafety(payload) ||
      (!!composed && !sameAllergenState(storedState(before), composed.state));
    // R6: saving never makes a version by itself (a draft is saved as it is typed);
    // the change waits until the recipe is "Prête" again, see `cutVersion`.
    const changed = versionContentChanged(current, write);

    // Nothing above wrote: a refused or lost save leaves the dish and its versions as read.
    const dish = await this.prisma
      .$transaction(async (tx) => {
        const row = await tx.meal.update({
          // Matches nothing once another save has moved the dish on since the read.
          where: { id, chefProfileId: chef.id, lockVersion: current.lockVersion },
          data: {
            ...write,
            lockVersion: { increment: 1 },
            ...(reverify && { allergensVerifiedAt: null }),
            ...(changed && { versionPending: true }),
            // The chef answered the change to the suggestion they adopted (§6).
            ...(safety && { sourceChangedAt: null }),
            // §3.2: allergens, diets or country changed on a public dish: admins look
            // again. Also on a draft they had already reviewed, so unpublishing, editing
            // and republishing cannot skip the queue (it lists public content only).
            ...(safety &&
              (current.status === MealStatus.published || current.reviewedAt) &&
              reviewFields(current, nextReviewReason(current, 'edited'), new Date())),
          },
        });
        return readiness(row).ready ? this.cutVersion(tx, row) : row;
      })
      .catch(savedMeanwhile(this.prisma, chef.id, id));
    if (reverify && current.allergensVerifiedAt !== null) {
      this.logger.log({ event: 'dish.allergens_verification_cleared', dishId: id });
    }
    return toDishView(dish);
  }

  /**
   * Recettes §4.9: the chef confirms the allergens computed from the ingredients,
   * plus the ones they added, are right. Needed to be "Prête", and for a dish to be
   * booked. Not a change to the recipe: `lockVersion` stays. Ruling R8: sent with
   * the `lockVersion` the chef read, it confirms only that version of the dish.
   *
   * Ruling R10: what is confirmed is always computed afresh from the common list.
   * If that differs from what the dish stores (lines never stamped, an entry changed
   * since), the fresh result is saved instead, unconfirmed, and the answer is 409
   * with the new `lockVersion`: the chef reloads, sees it, and confirms again.
   */
  async confirmAllergens(clerkUserId: string, id: string, lockVersion?: number | null) {
    const chef = await this.access.chef(clerkUserId);
    this.access.assertVerified(chef);
    const dish = await this.access.writableDish(chef, id);
    // Allergens changed since the chef read them (a second tab, the §7.3 propagation).
    if (lockVersion != null && lockVersion !== dish.lockVersion) {
      throw recipeConflict(dish.lockVersion);
    }
    const composed = await composeLines(
      this.prisma,
      dish,
      {},
      readLines(dish.ingredients),
    );
    assertConfirmable(composed);
    // Every write here matches only the version read: an update landing in between
    // answers 409 rather than having its changes confirmed unseen (race B).
    const asRead = { id, chefProfileId: chef.id, lockVersion: dish.lockVersion };

    if (!storesComposition(dish, composed)) {
      const columns = compositionColumns(composed);
      // Saved first, then refused: the 409 must not undo the fresh stamps.
      const row = await this.prisma.meal
        .update({
          where: asRead,
          data: {
            ...columns,
            lockVersion: { increment: 1 },
            allergensVerifiedAt: null,
            ...(versionContentChanged(dish, columns) && { versionPending: true }),
          },
        })
        .catch(savedMeanwhile(this.prisma, chef.id, id));
      this.logger.log({ event: 'dish.allergens_recomputed', dishId: id });
      throw recipeConflict(row.lockVersion);
    }

    // The changes the chef just verified become a version even if the recipe is not
    // "Prête" yet: a booking must never cook ingredients other than the ones whose
    // allergens were confirmed.
    const confirmed = await this.prisma
      .$transaction(async (tx) => {
        const row = await tx.meal.update({
          where: asRead,
          data: { allergensVerifiedAt: new Date() },
        });
        return this.cutVersion(tx, row);
      })
      .catch(savedMeanwhile(this.prisma, chef.id, id));
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
 * Recettes §8.1: a save matched nothing. If the dish is still the chef's, another
 * save (a second tab, the §7.3 propagation) moved its `lockVersion` on since the
 * read: 409 `RECIPE_CONFLICT` with the one to reload. Otherwise it is gone: 404.
 */
const savedMeanwhile =
  (db: Pick<PrismaService, 'meal'>, chefProfileId: string, id: string) =>
  async (error: unknown): Promise<never> => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      const row = await db.meal.findUnique({
        where: { id },
        select: { lockVersion: true, chefProfileId: true },
      });
      if (row && row.chefProfileId === chefProfileId) {
        throw recipeConflict(row.lockVersion);
      }
    }
    return goneMeanwhile('Dish')(error);
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
function versionContentChanged(
  current: Meal,
  write: Pick<MealColumns, 'portions' | 'steps' | 'storage'> & { ingredients?: unknown },
): boolean {
  const json = (value: unknown) => (value === Prisma.DbNull ? null : value);
  return (
    (write.portions !== undefined && write.portions !== current.portions) ||
    // Both sides read alike, so a line saved before a field existed is no change.
    (write.ingredients !== undefined &&
      !sameContent(readLines(current.ingredients), readLines(write.ingredients))) ||
    (write.steps !== undefined && !sameContent(readSteps(current.steps), write.steps)) ||
    (write.storage !== undefined &&
      !sameContent(
        current.storage && { container: null, ...(current.storage as object) },
        json(write.storage),
      ))
  );
}

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

/**
 * The declaration as it will be once `payload` is applied to `current`. Allergens
 * are computed (Recettes §6.1) and never contradict each other: only the free text
 * is left to check against the lists.
 */
function declarationOf(current: Meal | null, payload: UpdateDishDto): DeclarationState {
  return {
    allergens: [],
    allergensNone: false,
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
    payload.addedAllergens,
    payload.customAllergens,
    payload.diets,
    payload.customDiets,
    payload.country,
  ].some((value) => value !== undefined);

export function assertConsistent(state: DeclarationState): void {
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
 * on an update alike. Ownership, authorship and status are not among them, nor the
 * lines and allergens, which a composition writes (`compositionColumns`).
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
 * A `recipe` is replaced as a whole; its lines go through `composedSave`.
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
    steps: toStepsJson(recipe.steps),
    reheating: toReheatingJson(recipe.reheating),
    storage: toStorageJson(recipe.storage),
  };
}

/** What a save composes (Recettes §6.1), with the chef's own allergens it used. */
type Composition = Awaited<ReturnType<typeof compositionOf>> & {
  addedAllergens: string[];
  customAllergens: string[];
};

/**
 * Recettes §6.1: the lines stamped from the common list and the allergens computed
 * from them, when the save sends a recipe or the chef's own allergens; null when it
 * sends neither. Sent alone, the chef's allergens apply to the lines as stored.
 */
async function composedSave(
  db: Pick<PrismaService, 'catalogIngredient'>,
  current: Meal | null,
  payload: UpdateDishDto,
  lines?: LineToStamp[],
): Promise<Composition | null> {
  if (!lines && payload.addedAllergens == null && payload.customAllergens == null) {
    return null;
  }
  return composeLines(db, current, payload, lines ?? readLines(current?.ingredients));
}

/** The composition of `lines`, with the chef's allergens as `payload` leaves them. */
async function composeLines(
  db: Pick<PrismaService, 'catalogIngredient'>,
  current: Meal | null,
  payload: UpdateDishDto,
  lines: LineToStamp[],
): Promise<Composition> {
  // Ruling R7: what the chef declared by hand before the socle stays, as added.
  const addedAllergens = inAnnexOrder([
    ...(payload.addedAllergens ?? current?.addedAllergens ?? []),
    ...(current ? legacyDeclaredAllergens(current) : []),
  ]);
  const customAllergens = payload.customAllergens ?? current?.customAllergens ?? [];
  const composed = await compositionOf(db, lines, { addedAllergens, customAllergens });
  return { ...composed, addedAllergens, customAllergens };
}

/** The columns a composition sets: always written together, so they never disagree. */
const compositionColumns = (composed: Composition) => ({
  // Copied into plain objects, as a JSON column takes them.
  ingredients: composed.ingredients.map((line) => ({ ...line })),
  allergens: composed.state.allergens,
  conditionalAllergens: composed.state.conditionalAllergens,
  allergensNone: composed.state.allergensNone,
  classification: composed.classification ?? Prisma.DbNull,
  addedAllergens: composed.addedAllergens,
  customAllergens: composed.customAllergens,
});

/**
 * Ruling R10: the row already stores exactly what a fresh composition writes. The
 * lines are compared as stored, not as `readLines` reads them: a line never stamped
 * lacks `allergens`, which must count as a difference, never as "none".
 */
function storesComposition(meal: Meal, composed: Composition): boolean {
  const fresh = compositionColumns(composed);
  return (
    sameContent(meal.ingredients, fresh.ingredients) &&
    sameContent(meal.allergens, fresh.allergens) &&
    sameContent(meal.conditionalAllergens, fresh.conditionalAllergens) &&
    meal.allergensNone === fresh.allergensNone &&
    sameContent(meal.classification, composed.classification) &&
    sameContent(meal.addedAllergens, fresh.addedAllergens) &&
    sameContent(meal.customAllergens, fresh.customAllergens)
  );
}

/** Recettes §6.5: what the re-verification compares, as stored before the save… */
const storedSnapshot = (meal: Meal): SafetySnapshot => ({
  ingredients: meal.ingredients,
  addedAllergens: meal.addedAllergens,
  customAllergens: meal.customAllergens,
  allergens: meal.allergens,
  conditionalAllergens: meal.conditionalAllergens,
});

/** …and as the save leaves it. */
const composedSnapshot = (composed: Composition): SafetySnapshot => ({
  ingredients: composed.ingredients,
  addedAllergens: composed.addedAllergens,
  customAllergens: composed.customAllergens,
  allergens: composed.state.allergens,
  conditionalAllergens: composed.state.conditionalAllergens,
});

/** The row with its hand-declared allergens counted as added (ruling R7). */
const withLegacyAdded = (meal: Meal): Meal => ({
  ...meal,
  addedAllergens: inAnnexOrder([
    ...meal.addedAllergens,
    ...legacyDeclaredAllergens(meal),
  ]),
});

/** The allergen state the stored lines give, as the dish view shows it. */
const storedState = (meal: Meal) =>
  allergenStateOf(readLines(meal.ingredients), meal.addedAllergens, meal.customAllergens);

/**
 * Recettes §5.2 and R10: the lines a chef sends, ready to stamp. A line that breaks
 * the rules answers 422 `VALIDATION_FAILED`, `errors` naming its field; two lines
 * saying the same thing answer 422 `DUPLICATE_INGREDIENT_LINE` with their indexes.
 */
export function checkedLines(ingredients: IngredientDto[]): LineToStamp[] {
  const lines = ingredients.map(toLine);
  // The checks never read `hiddenFromClient`; left out, the entry decides it (§5.2).
  const inputs = lines.map((line) => ({
    ...line,
    hiddenFromClient: line.hiddenFromClient ?? false,
  }));
  const problems = lineInputProblems(inputs);
  if (problems.length) {
    throw validationFailed('Some ingredient lines are not valid.', { errors: problems });
  }
  const duplicates = duplicateLines(inputs);
  if (duplicates.length) throw duplicateIngredientLine(duplicates);
  return lines;
}

/*
 * Plain JSON, so nothing but the documented keys is ever stored. Shared with the
 * Lab's Food admin routes, which write the same columns.
 */

/** A line as sent, every field explicit but `hiddenFromClient`, which the entry may set. */
const toLine = (line: IngredientDto): LineToStamp => ({
  name: line.name,
  qty: line.qty ?? null,
  unit: line.unit ?? null,
  aisle: line.aisle ?? null,
  link: line.link ?? null,
  toVerify: line.toVerify ?? false,
  fixedQuantity: line.fixedQuantity ?? false,
  catalogIngredientId: line.catalogIngredientId ?? null,
  optional: line.optional ?? false,
  precision: line.precision ?? null,
  preparation: line.preparation ?? null,
  group: line.group ?? null,
  hiddenFromClient: line.hiddenFromClient ?? undefined,
  rawText: line.rawText ?? null,
});

/** The lines as sent, unstamped: the Lab's Food admin routes, until they compose too. */
export const toIngredientsJson = (ingredients: IngredientDto[]) =>
  ingredients.map((line) => ({
    ...toLine(line),
    hiddenFromClient: line.hiddenFromClient ?? false,
  }));

/**
 * Recettes §6.1: allergens are confirmed only once every line brings its own, as a
 * fresh composition stamps them (ruling R10). 422 `VALIDATION_FAILED` without a
 * line; 422 `INGREDIENT_NOT_LINKED` with the indexes of the lines not linked, or
 * linked to an ingredient still to complete; 422 `VALIDATION_FAILED` for an
 * allergen code outside the 14 (ruling R5).
 */
export function assertConfirmable(composed: {
  ingredients: StoredLine[];
  state: { allergens: string[] };
}): void {
  const lines = composed.ingredients;
  if (lines.length === 0) throw validationFailed('Add at least one ingredient first.');
  const unlinked = lines.flatMap((line, i) =>
    line.catalogIngredientId && !line.incomplete ? [] : [i],
  );
  if (unlinked.length) throw ingredientNotLinked(unlinked);
  const unknown = composed.state.allergens.filter(
    (code) => !ALLERGEN_CODES.includes(code),
  );
  if (unknown.length) {
    // Legacy or renamed codes: kept so no allergen is lost, but nothing to confirm yet.
    throw validationFailed(
      `Not one of the 14 regulated allergens: ${unknown.join(', ')}. Correct it first.`,
      { allergens: unknown },
    );
  }
}

/**
 * Recettes §4.10: a line may only point to an entry of the common list. The Lab's
 * Food admin routes; a chef's dish goes through `assertIngredientAccess`.
 */
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
        freezable: storage.freezable ?? false,
        freezerMonths: storage.freezerMonths ?? null,
        thawing: storage.thawing ?? null,
      }
    : Prisma.DbNull;
