import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { buildPaginationMeta, resolvePageBounds } from '../../common/dto/pagination.dto';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  classify,
  linkedIds,
  withChefVersions,
} from '../dishes/domain/classification.rules';
import { seasonReview } from './domain/season-review.rules';
import {
  CatalogIngredientDto,
  ListCatalogIngredientsQueryDto,
  UpdateCatalogIngredientDto,
} from './dto/ingredient.dto';

/**
 * Recettes §4.8: a recipe's diets and seasons from the entries it links, as the
 * `classification` column stores them (DbNull: "non calculé"). A chef's dish reads
 * their own version of an entry they adopted (BLK-33); Lab's Food dishes read the
 * common list only.
 */
export async function classificationOf(
  db: Pick<PrismaService, 'catalogIngredient' | 'chefIngredient'>,
  ingredients: unknown,
  chefProfileId?: string | null,
) {
  const ids = linkedIds(ingredients);
  const [entries, own] = ids.length
    ? await Promise.all([
        db.catalogIngredient.findMany({
          where: { id: { in: ids } },
          select: { id: true, diets: true, seasonMonths: true },
        }),
        chefProfileId
          ? db.chefIngredient.findMany({
              where: { chefProfileId, catalogIngredientId: { in: ids } },
              select: { catalogIngredientId: true, diets: true, seasonMonths: true },
            })
          : Promise.resolve([]),
      ])
    : [[], []];
  return classify(ingredients, withChefVersions(entries, own)) ?? Prisma.DbNull;
}

/** A search shows a short list to pick from, never the whole table (every list has a cap). */
const SEARCH_LIMIT = 20;

/** Entries one batch cooker may adopt (every list has a cap). */
export const CHEF_INGREDIENTS_CAP = 500;

/** When the admin last confirmed the list fits the season (BLK-33). */
const SEASON_REVIEW_KEY = 'ingredients_season_review';

/**
 * Recettes §4.10: the common ingredient list. The Lab's Food admin fills it
 * (BLK-33); a batch cooker searches it to link a recipe line, from which the
 * dish's diets and seasons are computed.
 */
@Injectable()
export class IngredientsService {
  private readonly logger = new Logger(IngredientsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** For the console: the list by page, by name, optionally filtered. */
  async list(query: ListCatalogIngredientsQueryDto) {
    const bounds = resolvePageBounds(query);
    const where = query.search ? matching(query.search) : {};
    const [rows, total, reviewedAt] = await Promise.all([
      this.prisma.catalogIngredient.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: bounds.skip,
        take: bounds.take,
      }),
      this.prisma.catalogIngredient.count({ where }),
      this.lastSeasonReview(),
    ]);
    const listSize = query.search ? await this.prisma.catalogIngredient.count() : total;
    return {
      data: rows,
      meta: buildPaginationMeta(bounds, total),
      seasonReview: seasonReview(new Date(), reviewedAt, listSize),
    };
  }

  /** The admin confirms the list fits the season: the reminder goes until the next one. */
  async markSeasonReviewed(adminUserId: string, requestId?: string) {
    const now = new Date();
    await this.prisma.platformSetting.upsert({
      where: { key: SEASON_REVIEW_KEY },
      update: { value: { reviewedAt: now.toISOString() }, updatedByUserId: adminUserId },
      create: {
        key: SEASON_REVIEW_KEY,
        value: { reviewedAt: now.toISOString() },
        updatedByUserId: adminUserId,
      },
    });
    const review = seasonReview(now, now, await this.prisma.catalogIngredient.count());
    await this.audit.record({
      actorType: 'admin',
      actorUserId: adminUserId,
      action: 'catalog_ingredient.season_reviewed',
      subjectType: 'platform_setting',
      metadata: { season: review.season },
      requestId,
    });
    return review;
  }

  private async lastSeasonReview(): Promise<Date | null> {
    const row = await this.prisma.platformSetting.findUnique({
      where: { key: SEASON_REVIEW_KEY },
    });
    const at = (row?.value as { reviewedAt?: unknown } | null)?.reviewedAt;
    return typeof at === 'string' ? new Date(at) : null;
  }

  /** BLK-33: the entries a batch cooker adopted, by name. */
  listMine(chefProfileId: string) {
    return this.prisma.chefIngredient.findMany({
      where: { chefProfileId },
      orderBy: { name: 'asc' },
      take: CHEF_INGREDIENTS_CAP,
    });
  }

  /**
   * Copies an entry of the common list into the chef's own list, to edit. The copy
   * classifies like the original, so no dish changes. Adopting twice returns the
   * chef's version as it is.
   */
  async adopt(chefProfileId: string, catalogIngredientId: string) {
    const entry = await this.prisma.catalogIngredient.findFirst({
      where: { id: catalogIngredientId },
    });
    if (!entry) throw ingredientNotFound();
    if (
      (await this.prisma.chefIngredient.count({ where: { chefProfileId } })) >=
      CHEF_INGREDIENTS_CAP
    ) {
      throw new UnprocessableEntityException({
        code: 'CHEF_INGREDIENTS_LIMIT',
        message: `A batch cooker keeps at most ${CHEF_INGREDIENTS_CAP} ingredients of their own.`,
        limit: CHEF_INGREDIENTS_CAP,
      });
    }
    const row = await this.prisma.chefIngredient.upsert({
      where: {
        chefProfileId_catalogIngredientId: { chefProfileId, catalogIngredientId },
      },
      update: {},
      create: {
        chefProfileId,
        catalogIngredientId,
        name: entry.name,
        aliases: entry.aliases,
        diets: entry.diets,
        seasonMonths: entry.seasonMonths,
      },
    });
    this.logger.log({
      event: 'chef_ingredient.adopted',
      chefProfileId,
      catalogIngredientId,
    });
    return row;
  }

  /** Only the fields sent change; the chef's dishes linking it are classified again. */
  async updateMine(
    chefProfileId: string,
    id: string,
    payload: UpdateCatalogIngredientDto,
  ) {
    const own = await this.ownVersion(chefProfileId, id);
    const data = toWrite(payload);
    const row = await this.prisma.chefIngredient.update({ where: { id }, data });
    const reclassified =
      data.diets !== undefined || data.seasonMonths !== undefined
        ? await this.reclassifyChef(chefProfileId, own.catalogIngredientId)
        : 0;
    this.logger.log({
      event: 'chef_ingredient.updated',
      chefProfileId,
      chefIngredientId: id,
      fields: Object.keys(data),
      reclassified,
    });
    return row;
  }

  /** Back to the common entry: the chef's dishes linking it are classified from it. */
  async removeMine(chefProfileId: string, id: string) {
    const own = await this.ownVersion(chefProfileId, id);
    await this.prisma.chefIngredient.delete({ where: { id } });
    const reclassified = await this.reclassifyChef(
      chefProfileId,
      own.catalogIngredientId,
    );
    this.logger.log({
      event: 'chef_ingredient.removed',
      chefProfileId,
      chefIngredientId: id,
      reclassified,
    });
  }

  /** Someone else's version is reported missing, never revealed. */
  private async ownVersion(chefProfileId: string, id: string) {
    const own = await this.prisma.chefIngredient.findFirst({
      where: { id, chefProfileId },
    });
    if (!own) {
      throw new NotFoundException({
        code: 'CHEF_INGREDIENT_NOT_FOUND',
        message: 'No such ingredient in your list.',
      });
    }
    return own;
  }

  private async reclassifyChef(chefProfileId: string, catalogIngredientId: string) {
    const meals = await this.prisma.meal.findMany({
      where: {
        chefProfileId,
        ingredients: { array_contains: [{ catalogIngredientId }] },
      },
      select: { id: true, chefProfileId: true, ingredients: true },
    });
    return this.reclassifyMeals(meals);
  }

  /** For the recipe form: a short list matching what the chef types. */
  search(term: string) {
    return this.prisma.catalogIngredient.findMany({
      where: matching(term),
      orderBy: { name: 'asc' },
      take: SEARCH_LIMIT,
    });
  }

  async create(payload: CatalogIngredientDto, adminUserId: string) {
    const data = toWrite(payload) as Prisma.CatalogIngredientCreateInput;
    await this.assertNameFree(data.name);
    const row = await this.prisma.catalogIngredient.create({ data }).catch(nameTaken);
    await this.audit.record({
      actorType: 'admin',
      actorUserId: adminUserId,
      action: 'catalog_ingredient.created',
      subjectType: 'catalog_ingredient',
      subjectId: row.id,
    });
    return row;
  }

  async update(id: string, payload: UpdateCatalogIngredientDto, adminUserId: string) {
    const data = toWrite(payload);
    if (data.name) await this.assertNameFree(data.name, id);
    const row = await this.prisma.catalogIngredient
      .update({ where: { id }, data })
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2025'
        ) {
          throw new NotFoundException('Ingredient not found.');
        }
        return nameTaken(error);
      });
    const reclassified =
      data.diets !== undefined || data.seasonMonths !== undefined
        ? await this.reclassify(id)
        : 0;
    await this.audit.record({
      actorType: 'admin',
      actorUserId: adminUserId,
      action: 'catalog_ingredient.updated',
      subjectType: 'catalog_ingredient',
      subjectId: id,
      metadata: { fields: Object.keys(data), reclassified },
    });
    return row;
  }

  /** The dishes linking this entry, classified again: the stored result never goes stale. */
  private async reclassify(id: string): Promise<number> {
    const meals = await this.prisma.meal.findMany({
      where: { ingredients: { array_contains: [{ catalogIngredientId: id }] } },
      select: { id: true, chefProfileId: true, ingredients: true },
    });
    return this.reclassifyMeals(meals);
  }

  private async reclassifyMeals(
    meals: { id: string; chefProfileId: string | null; ingredients: unknown }[],
  ): Promise<number> {
    for (const meal of meals) {
      await this.prisma.meal.update({
        where: { id: meal.id },
        data: {
          classification: await classificationOf(
            this.prisma,
            meal.ingredients,
            meal.chefProfileId,
          ),
        },
      });
    }
    return meals.length;
  }

  /** The same name twice, in another case, would split the computed diets. */
  private async assertNameFree(name: string, except?: string) {
    const taken = await this.prisma.catalogIngredient.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(except && { id: { not: except } }),
      },
      select: { id: true },
    });
    if (taken) throw alreadyListed();
  }
}

const matching = (term: string): Prisma.CatalogIngredientWhereInput => ({
  OR: [
    { name: { contains: term, mode: 'insensitive' } },
    { aliases: { has: term.toLowerCase() } },
  ],
});

/** Trimmed names, aliases folded, months sorted once each. */
function toWrite(payload: UpdateCatalogIngredientDto) {
  const data: Prisma.CatalogIngredientUpdateInput & { name?: string } = {};
  if (payload.name !== undefined) data.name = payload.name.trim();
  if (payload.aliases !== undefined) {
    data.aliases = [
      ...new Set(payload.aliases.map((a) => a.trim().toLowerCase()).filter(Boolean)),
    ];
  }
  if (payload.diets !== undefined) data.diets = [...new Set(payload.diets)];
  if (payload.seasonMonths !== undefined) {
    data.seasonMonths = [...new Set(payload.seasonMonths)].sort((a, b) => a - b);
  }
  return data;
}

const ingredientNotFound = () =>
  new NotFoundException({
    code: 'INGREDIENT_NOT_FOUND',
    message: 'No such ingredient in the common list.',
  });

const alreadyListed = () =>
  new ConflictException({
    code: 'INGREDIENT_ALREADY_LISTED',
    message: 'An ingredient of this name is already in the list.',
  });

function nameTaken(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw alreadyListed();
  }
  throw error;
}
