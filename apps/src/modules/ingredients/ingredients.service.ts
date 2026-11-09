import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { buildPaginationMeta, resolvePageBounds } from '../../common/dto/pagination.dto';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { classify, linkedIds } from '../dishes/domain/classification.rules';
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
  const ids = linkedIds(ingredients);
  const entries = ids.length
    ? await db.catalogIngredient.findMany({
        where: { id: { in: ids } },
        select: { id: true, diets: true, seasonMonths: true },
      })
    : [];
  return classify(ingredients, new Map(entries.map((e) => [e.id, e]))) ?? Prisma.DbNull;
}

/** A search shows a short list to pick from, never the whole table (every list has a cap). */
const SEARCH_LIMIT = 20;

/**
 * Recettes §4.10: the common ingredient list. The Lab's Food admin fills it
 * (BLK-33); a batch cooker searches it to link a recipe line, from which the
 * dish's diets and seasons are computed.
 */
@Injectable()
export class IngredientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** For the console: the list by page, by name, optionally filtered. */
  async list(query: ListCatalogIngredientsQueryDto) {
    const bounds = resolvePageBounds(query);
    const where = query.search ? matching(query.search) : {};
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
