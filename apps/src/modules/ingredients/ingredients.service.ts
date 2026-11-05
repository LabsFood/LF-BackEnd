import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { buildPaginationMeta, resolvePageBounds } from '../../common/dto/pagination.dto';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { toLineInput } from '../dishes/domain/recipe-lines.rules';
import { aislesInForce } from '../platform-settings/recipe-lists';
import { compositionOf } from './composition';
import { normalizeName, withImpliedDiets } from './domain/ingredient.rules';
import {
  CatalogIngredientDto,
  ListCatalogIngredientsQueryDto,
  UpdateCatalogIngredientDto,
} from './dto/ingredient.dto';

/**
 * Recettes §4.8: a recipe's diets and seasons from the entries it links, as the
 * `classification` column stores them (DbNull: "non calculé").
 */
export async function classificationOf(
  db: Pick<PrismaService, 'catalogIngredient'>,
  ingredients: unknown,
) {
  const lines = (Array.isArray(ingredients) ? ingredients : []).map(toLineInput);
  const { classification } = await compositionOf(db, lines, {
    addedAllergens: [],
    customAllergens: [],
  });
  return classification ?? Prisma.DbNull;
}

/** A search shows a short list to pick from, never the whole table (every list has a cap). */
const SEARCH_LIMIT = 20;

/**
 * Recettes §4.10 / §5.1: the common ingredient list. The Lab's Food admin fills it
 * (BLK-33); a batch cooker searches it to link a recipe line, from which the
 * dish's diets, seasons and allergens are computed.
 */
@Injectable()
export class IngredientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** For the console: the list by page, every entry (private ones too), filtered. */
  async list(query: ListCatalogIngredientsQueryDto) {
    const bounds = resolvePageBounds(query);
    const filters: Prisma.CatalogIngredientWhereInput[] = [];
    if (query.search) filters.push(matching(query.search));
    if (query.status) filters.push({ status: query.status });
    if (query.aisle) filters.push({ aisle: query.aisle });
    // Recettes §5.1: incomplete = no aisle, or allergens neither listed nor "none".
    if (query.incomplete) {
      filters.push({
        OR: [
          { aisle: null },
          { AND: [{ allergens: { isEmpty: true } }, { allergensNone: false }] },
        ],
      });
    }
    if (query.reviewed !== undefined) {
      filters.push(query.reviewed ? { reviewedAt: { not: null } } : { reviewedAt: null });
    }
    const where: Prisma.CatalogIngredientWhereInput = filters.length
      ? { AND: filters }
      : {};
    const [rows, total] = await Promise.all([
      this.prisma.catalogIngredient.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: bounds.skip,
        take: bounds.take,
      }),
      this.prisma.catalogIngredient.count({ where }),
    ]);
    return { data: rows, meta: buildPaginationMeta(bounds, total) };
  }

  /**
   * For the recipe form (Recettes §4.10): the common active entries and the
   * caller's own pending ones. Never another chef's, never inactive or merged.
   */
  async search(term: string, chefProfileId: string | null) {
    const rows = await this.prisma.catalogIngredient.findMany({
      where: {
        AND: [
          {
            OR: [
              { chefProfileId: null, status: 'active' },
              ...(chefProfileId ? [{ chefProfileId, status: 'pending' }] : []),
            ],
          },
          matching(term),
        ],
      },
      orderBy: { name: 'asc' },
      take: SEARCH_LIMIT,
    });
    return rows.map((row) => ({ ...row, private: row.chefProfileId !== null }));
  }

  async create(payload: CatalogIngredientDto, adminUserId: string) {
    const data = (await this.toWrite(payload)) as Prisma.CatalogIngredientCreateInput;
    const normalized = data.normalizedName as string;
    await this.assertNameFree(normalized);
    const row = await this.prisma.catalogIngredient
      .create({ data })
      .catch((error: unknown) => this.nameTaken(error, normalized));
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
    if (payload.status !== undefined) await this.assertCommon(id);
    const data = await this.toWrite(payload);
    if (payload.status !== undefined) data.status = payload.status;
    const normalized = data.normalizedName as string | undefined;
    if (normalized) await this.assertNameFree(normalized, id);
    const row = await this.prisma.catalogIngredient
      .update({ where: { id }, data })
      .catch((error: unknown) => {
        if (isNotFound(error)) throw new NotFoundException('Ingredient not found.');
        return this.nameTaken(error, normalized, id);
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

  /** Recettes §5.1: the admin has checked the entry's aisle and allergens. */
  async review(id: string, adminUserId: string) {
    const row = await this.prisma.catalogIngredient
      .update({
        where: { id },
        data: { reviewedAt: new Date(), reviewedByUserId: adminUserId },
      })
      .catch((error: unknown) => {
        if (isNotFound(error)) throw new NotFoundException('Ingredient not found.');
        throw error;
      });
    await this.audit.record({
      actorType: 'admin',
      actorUserId: adminUserId,
      action: 'catalog_ingredient.reviewed',
      subjectType: 'catalog_ingredient',
      subjectId: id,
    });
    return row;
  }

  /** A status is the admin's to change on a common entry; a private one follows its chef. */
  private async assertCommon(id: string) {
    const row = (await this.prisma.catalogIngredient.findUnique({
      where: { id },
      select: { chefProfileId: true, status: true },
    })) as { chefProfileId: string | null; status: string } | null;
    if (!row) throw new NotFoundException('Ingredient not found.');
    if (row.chefProfileId !== null) {
      throw new UnprocessableEntityException({
        code: 'INGREDIENT_PRIVATE',
        message: 'The status of a chef’s private ingredient cannot be changed here.',
      });
    }
    // merged and pending are the system's states: only active and inactive swap here.
    if (row.status !== 'active' && row.status !== 'inactive') {
      throw new UnprocessableEntityException({
        code: 'INGREDIENT_STATUS_LOCKED',
        message: 'A merged or pending ingredient never changes status here.',
      });
    }
  }

  /** The dishes linking this entry, classified again: the stored result never goes stale. */
  private async reclassify(id: string): Promise<number> {
    const meals = await this.prisma.meal.findMany({
      where: { ingredients: { array_contains: [{ catalogIngredientId: id }] } },
      select: { id: true, ingredients: true },
    });
    for (const meal of meals) {
      await this.prisma.meal.update({
        where: { id: meal.id },
        data: { classification: await classificationOf(this.prisma, meal.ingredients) },
      });
    }
    return meals.length;
  }

  /** The same name twice, in another case or accents, would split the computed diets. */
  private async assertNameFree(normalizedName: string, except?: string) {
    const taken = await this.prisma.catalogIngredient.findFirst({
      where: {
        normalizedName,
        chefProfileId: null,
        status: { not: 'merged' },
        ...(except && { id: { not: except } }),
      },
      select: { id: true, name: true },
    });
    if (taken) throw alreadyListed(taken);
  }

  /** The unique index answered first (a race): the same 409, with the entry that won. */
  private async nameTaken(
    error: unknown,
    normalizedName?: string,
    id?: string,
  ): Promise<never> {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // An update without a name collides on the stored one.
      if (!normalizedName && id) {
        const stored = (await this.prisma.catalogIngredient.findUnique({
          where: { id },
          select: { name: true },
        })) as { name: string } | null;
        normalizedName = stored ? normalizeName(stored.name) : undefined;
      }
      const existing = normalizedName
        ? await this.prisma.catalogIngredient.findFirst({
            where: {
              normalizedName,
              chefProfileId: null,
              status: { not: 'merged' },
              ...(id && { id: { not: id } }),
            },
            select: { id: true, name: true },
          })
        : null;
      throw alreadyListed(existing ?? undefined);
    }
    throw error;
  }

  /**
   * Trimmed names with their normalized form, aliases folded, implied diets added,
   * months sorted once each, the aisle checked against the list in force, and the
   * allergen state kept coherent (listed, or "none", never both).
   */
  private async toWrite(payload: UpdateCatalogIngredientDto) {
    const data: Prisma.CatalogIngredientUpdateInput & { name?: string } = {};
    if (payload.name !== undefined) {
      data.name = payload.name.trim();
      data.normalizedName = normalizeName(data.name);
    }
    if (payload.aliases !== undefined) {
      data.aliases = [
        ...new Set(payload.aliases.map((a) => a.trim().toLowerCase()).filter(Boolean)),
      ];
    }
    if (payload.diets !== undefined) data.diets = withImpliedDiets(payload.diets);
    if (payload.seasonMonths !== undefined) {
      data.seasonMonths = [...new Set(payload.seasonMonths)].sort((a, b) => a - b);
    }
    if (payload.aisle !== undefined) {
      const aisles = await aislesInForce(this.prisma);
      if (!aisles.some((item) => item.code === payload.aisle)) {
        throw new UnprocessableEntityException({
          code: 'AISLE_UNKNOWN',
          message: 'This aisle is not in the list.',
        });
      }
      data.aisle = payload.aisle;
    }
    if (payload.allergens?.length && payload.allergensNone) {
      throw new UnprocessableEntityException({
        code: 'ALLERGENS_CONFLICT',
        message: 'An ingredient cannot list allergens and declare none.',
      });
    }
    if (payload.allergens !== undefined) {
      data.allergens = [...new Set(payload.allergens)];
      if (payload.allergens.length > 0 && payload.allergensNone === undefined) {
        data.allergensNone = false;
      }
    }
    if (payload.allergensNone !== undefined) {
      data.allergensNone = payload.allergensNone;
      if (payload.allergensNone) data.allergens = [];
    }
    if (payload.isBasic !== undefined) data.isBasic = payload.isBasic;
    return data;
  }
}

const isNotFound = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';

/** Name, normalized name (accents never defeat a search) or another name. */
const matching = (term: string): Prisma.CatalogIngredientWhereInput => ({
  OR: [
    { name: { contains: term, mode: 'insensitive' } },
    { normalizedName: { contains: normalizeName(term) } },
    { aliases: { has: term.toLowerCase() } },
  ],
});

const alreadyListed = (existing?: { id: string; name: string }) =>
  new ConflictException({
    code: 'INGREDIENT_ALREADY_LISTED',
    message: 'An ingredient of this name is already in the list.',
    ...(existing && { ingredient: { id: existing.id, name: existing.name } }),
  });
