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
import { inAnnexOrder } from '../dishes/domain/allergens.rules';
import { NotificationsService } from '../notifications/notifications.service';
import { aislesInForce } from '../platform-settings/recipe-lists';
import { normalizeName, withImpliedDiets } from './domain/ingredient.rules';
import {
  CatalogIngredientDto,
  ListCatalogIngredientsQueryDto,
  UpdateCatalogIngredientDto,
} from './dto/ingredient.dto';
import {
  dishesLinking,
  IngredientPropagationService,
  mergedInto,
  PropagationResult,
} from './ingredient-propagation.service';

/** Ruling R25: a private entry's chef, by name only (never an e-mail or other personal data). */
const WITH_CHEF = {
  chefProfile: { select: { id: true, displayName: true } },
} as const;

type Chef = { id: string; displayName: string };

/**
 * The admin shape of an entry: `chef` in place of the joined profile, null when
 * common, and (ruling R28) `carryPending`, true while a carry of the entry into the
 * recipes has not ended with no failed dish.
 */
function withChef<T extends object>(row: T) {
  const { chefProfile, ...rest } = row as T & {
    chefProfile?: Chef | null;
    carryPendingAt?: Date | null;
  };
  return {
    ...rest,
    chef: chefProfile
      ? { id: chefProfile.id, displayName: chefProfile.displayName }
      : null,
    carryPending: rest.carryPendingAt != null,
  };
}

/**
 * What a chef sees of an ingredient (the Swagger example): never the author's or
 * reviewer's user ids, the owner profile or the search key. `/me/ingredients` and
 * `GET /ingredients` (with `private`) both answer it.
 */
export function toPublic(row: {
  id: string;
  name: string;
  aliases: string[];
  diets: string[];
  seasonMonths: number[];
  aisle: string | null;
  allergens: string[];
  allergensNone: boolean;
  isBasic: boolean;
  status: string;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  mergedInto?: { id: string; name: string } | null;
}) {
  return {
    id: row.id,
    name: row.name,
    aliases: row.aliases,
    diets: row.diets,
    seasonMonths: row.seasonMonths,
    aisle: row.aisle,
    allergens: row.allergens,
    allergensNone: row.allergensNone,
    isBasic: row.isBasic,
    status: row.status,
    mergedInto: row.mergedInto ?? null,
    reviewedAt: row.reviewedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The most dishes `dishes()` lists. */
const DISHES_LIMIT = 200;

/** A search shows a short list to pick from, never the whole table (every list has a cap). */
const SEARCH_LIMIT = 20;

/**
 * Recettes §7.3: what a recipe line copies from its entry (name, aisle, allergens)
 * or computes from it (diets, months). A change to one is carried into the recipes.
 * The status is not among them: an inactive entry stays valid on its lines (§5.1).
 */
export const CARRIED = {
  name: true,
  aisle: true,
  allergens: true,
  allergensNone: true,
  diets: true,
  seasonMonths: true,
} as const;

export type Carried = Prisma.CatalogIngredientGetPayload<{ select: typeof CARRIED }>;

/**
 * Recettes §4.10 / §5.1: the common ingredient list. The Lab's Food admin fills it
 * (BLK-33); a batch cooker searches it to link a recipe line, from which the
 * dish's diets, seasons and allergens are computed.
 */
@Injectable()
export class IngredientsService {
  private readonly logger = new Logger(IngredientsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly propagation: IngredientPropagationService,
    private readonly notifications: NotificationsService,
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
    // Ruling R28: the entries whose carry into the recipes is still to replay.
    if (query.carryPending !== undefined) {
      filters.push(
        query.carryPending ? { carryPendingAt: { not: null } } : { carryPendingAt: null },
      );
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
        include: WITH_CHEF,
        orderBy: { name: 'asc' },
        skip: bounds.skip,
        take: bounds.take,
      }),
      this.prisma.catalogIngredient.count({ where }),
    ]);
    return { data: rows.map(withChef), meta: buildPaginationMeta(bounds, total) };
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
    // I1: the public shape, never the raw row (no user ids, owner or search key).
    return rows.map((row) => ({
      ...toPublic(row),
      private: row.chefProfileId !== null,
    }));
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
    // Created common: no chef.
    return withChef(row);
  }

  /**
   * Recettes §7.3: a change to what recipe lines copy or compute from the entry is
   * carried into every recipe linking it, after the entry is saved and journaled.
   * Ruling R28: the save marks the carry pending in its own transaction; the carry
   * clears the mark when no dish failed. Answers the entry (`carryPending` as the
   * carry left it) with the figures of that propagation (null when nothing was
   * carried), so the console can warn about `failed` dishes and offer the replay.
   */
  async update(id: string, payload: UpdateCatalogIngredientDto, adminUserId: string) {
    const before = (await this.prisma.catalogIngredient.findUnique({
      where: { id },
      select: { ...CARRIED, chefProfileId: true, status: true, normalizedName: true },
    })) as
      | (Carried & {
          chefProfileId: string | null;
          status: string;
          normalizedName: string | null;
        })
      | null;
    if (!before) throw new NotFoundException('Ingredient not found.');
    if (payload.status !== undefined) assertCommon(before);
    const data = await this.toWrite(payload);
    if (payload.status !== undefined) data.status = payload.status;
    // I2: a lot 2 entry's key is NULL until the reprise fills it; its name gives it.
    const ownKey = before.normalizedName ?? normalizeName(before.name);
    let normalized = data.normalizedName as string | undefined;
    // A name that keeps the entry's own key creates no duplicate: only a new key is
    // checked (the unique index still guards the stored ones).
    if (normalized && normalized !== ownKey) await this.assertNameFree(normalized, id);
    if (!normalized && before.normalizedName === null && ownKey) {
      // I2: any write fills a legacy key, unless another entry holds it: then it stays
      // NULL for the reprise to report, and the admin's edit still lands.
      if (!(await this.nameHolder(ownKey, id))) {
        data.normalizedName = normalized = ownKey;
      }
    }
    const { row, carried } = await this.prisma
      .$transaction(async (tx) => {
        const written = await tx.catalogIngredient.update({
          where: { id },
          data,
          include: WITH_CHEF,
        });
        const due = carriedChanged(before, written);
        // Ruling R28: a carry is due, marked with the change it carries, so a run cut
        // short (a restart) is never silent. The carry clears it.
        return {
          row: due
            ? {
                ...written,
                carryPendingAt: (await markCarryPending(tx, id)).carryPendingAt,
              }
            : written,
          carried: due,
        };
      })
      .catch((error: unknown) => {
        if (isNotFound(error)) throw new NotFoundException('Ingredient not found.');
        return this.nameTaken(error, normalized, id);
      });
    await this.audit.record({
      actorType: 'admin',
      actorUserId: adminUserId,
      action: 'catalog_ingredient.updated',
      subjectType: 'catalog_ingredient',
      subjectId: id,
      metadata: { fields: Object.keys(data), propagated: carried },
    });
    // Records its own audit entry, with its figures.
    const propagation = carried
      ? await this.propagation.propagate([id], { type: 'admin', userId: adminUserId })
      : null;
    return {
      ingredient: withChef(propagation ? await this.withPendingRead(row) : row),
      propagation,
    };
  }

  /** Ruling R28: the mark as the carry just left it, read again. */
  private async withPendingRead<T extends { id: string }>(row: T) {
    const now = (await this.prisma.catalogIngredient.findUnique({
      where: { id: row.id },
      select: { carryPendingAt: true },
    })) as { carryPendingAt: Date | null } | null;
    return { ...row, carryPendingAt: now?.carryPendingAt ?? null };
  }

  /**
   * Recettes §7.2: Lab's Food keeps a chef's pending ingredient as a common one. It
   * leaves its chef (anyone may link it now), the author is told. Nothing a line
   * copies changes, so no recipe is carried, and no carry is marked pending (ruling
   * R28). A common entry already holding the name answers 409: the admin merges
   * instead.
   */
  async validate(id: string, adminUserId: string) {
    const entry = await this.pendingEntry(id);
    const normalized = entry.normalizedName ?? normalizeName(entry.name);
    await this.assertNameFree(normalized);
    const row = await this.prisma.catalogIngredient
      .update({
        // The state read: a chef edit, a merge or a validation in between finds
        // nothing to write.
        where: { id, status: 'pending' },
        data: {
          chefProfileId: null,
          status: 'active',
          reviewedAt: new Date(),
          reviewedByUserId: adminUserId,
        },
      })
      .catch((error: unknown) => {
        if (isNotFound(error)) throw notPending();
        return this.nameTaken(error, normalized, id);
      });
    await this.audit.record({
      actorType: 'admin',
      actorUserId: adminUserId,
      action: 'catalog_ingredient.validated',
      subjectType: 'catalog_ingredient',
      subjectId: id,
    });
    await this.tellAuthor(entry.createdByUserId, 'ingredient_validated', id);
    // It left its chef: common now.
    return { ingredient: withChef(row), propagation: null as PropagationResult | null };
  }

  /**
   * Recettes §7.2: Lab's Food merges a chef's pending ingredient into a common active
   * one. Recipe lines linking the old entry link the target instead (the
   * propagation, §7.3), and the author is told.
   */
  async merge(id: string, intoId: string, adminUserId: string) {
    const entry = await this.pendingEntry(id);
    const target =
      id === intoId
        ? null
        : ((await this.prisma.catalogIngredient.findUnique({
            where: { id: intoId },
            select: { id: true, status: true, chefProfileId: true },
          })) as { id: string; status: string; chefProfileId: string | null } | null);
    if (!target || target.chefProfileId !== null || target.status !== 'active') {
      throw new UnprocessableEntityException({
        code: 'INGREDIENT_MERGE_TARGET_INVALID',
        message: 'An ingredient merges into a common, active ingredient.',
      });
    }
    const row = await this.prisma.catalogIngredient
      .update({
        where: { id, status: 'pending' },
        data: {
          status: 'merged',
          mergedIntoId: intoId,
          reviewedAt: new Date(),
          reviewedByUserId: adminUserId,
          // Ruling R28: its lines are to repoint, marked in the same write; the
          // carry below (or a replay of this entry or its target) clears it.
          carryPendingAt: new Date(),
        },
        include: WITH_CHEF,
      })
      .catch((error: unknown) => {
        if (isNotFound(error)) throw notPending();
        throw error;
      });
    await this.audit.record({
      actorType: 'admin',
      actorUserId: adminUserId,
      action: 'catalog_ingredient.merged',
      subjectType: 'catalog_ingredient',
      subjectId: id,
      metadata: { intoId },
    });
    // Records its own audit entry, with its figures.
    const propagation = await this.propagation.propagate(
      [intoId],
      { type: 'admin', userId: adminUserId },
      { from: id, to: intoId },
    );
    await this.tellAuthor(entry.createdByUserId, 'ingredient_merged', id);
    return { ingredient: withChef(await this.withPendingRead(row)), propagation };
  }

  /**
   * Ruling R14: the admin replays the Recettes §7.3 propagation of an entry, when a
   * run was cut short or some dishes failed. Idempotent: dishes already stamped from
   * the entry as it stands are not written again, and nobody is told twice. Ruling
   * R28: a replay with no failed dish clears the entry's `carryPending`.
   */
  async propagate(id: string, adminUserId: string) {
    const entry = await this.prisma.catalogIngredient.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!entry) throw new NotFoundException('Ingredient not found.');
    return this.propagation.propagate([id], { type: 'admin', userId: adminUserId });
  }

  /**
   * Recettes §7.2: before a change is saved, what it would touch. The dishes linking
   * the entry (or an entry merged into it, as the propagation finds them), their
   * chefs, and the verified ones, which lose their verification if the allergens
   * change.
   */
  async impact(id: string) {
    const entry = await this.prisma.catalogIngredient.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!entry) throw new NotFoundException('Ingredient not found.');
    const dishes = await this.prisma.meal.findMany({
      where: dishesLinking([id, ...(await mergedInto(this.prisma, [id]))]),
      select: { chefProfileId: true, allergensVerifiedAt: true },
    });
    return {
      dishes: dishes.length,
      // Lab's Food recipes count as dishes, with no chef.
      chefs: new Set(dishes.flatMap((dish) => dish.chefProfileId ?? [])).size,
      verifiedDishes: dishes.filter((dish) => dish.allergensVerifiedAt !== null).length,
    };
  }

  /**
   * Ruling R25: the dishes whose lines link the entry (or an entry merged into it),
   * with their chef, by name, 200 at most, `total` counting them all.
   */
  async dishes(id: string) {
    const entry = await this.prisma.catalogIngredient.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!entry) throw new NotFoundException('Ingredient not found.');
    const where = dishesLinking([id, ...(await mergedInto(this.prisma, [id]))]);
    const [rows, total] = await Promise.all([
      this.prisma.meal.findMany({
        where,
        select: {
          id: true,
          name: true,
          status: true,
          allergensVerifiedAt: true,
          chefProfile: { select: { id: true, displayName: true } },
        },
        orderBy: { name: 'asc' },
        take: DISHES_LIMIT,
      }),
      this.prisma.meal.count({ where }),
    ]);
    return {
      data: rows.map(({ chefProfile, ...dish }) => ({
        ...dish,
        chef: chefProfile
          ? { id: chefProfile.id, displayName: chefProfile.displayName }
          : null,
      })),
      total,
    };
  }

  /** Recettes §5.1: the admin has checked the entry's aisle and allergens. */
  async review(id: string, adminUserId: string) {
    const row = await this.prisma.catalogIngredient
      .update({
        where: { id },
        data: { reviewedAt: new Date(), reviewedByUserId: adminUserId },
        include: WITH_CHEF,
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
    // The admin shape, as every other admin write answers it.
    return withChef(row);
  }

  /** A chef's pending entry, for the admin to rule on: 404 unknown, 422 any other state. */
  private async pendingEntry(id: string) {
    const entry = (await this.prisma.catalogIngredient.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        normalizedName: true,
        status: true,
        createdByUserId: true,
      },
    })) as {
      id: string;
      name: string;
      normalizedName: string | null;
      status: string;
      createdByUserId: string | null;
    } | null;
    if (!entry) throw new NotFoundException('Ingredient not found.');
    if (entry.status !== 'pending') throw notPending();
    return entry;
  }

  private async tellAuthor(userId: string | null, type: string, id: string) {
    if (!userId) return;
    // Best effort: the ruling is committed, a failed notice never turns it into a 500.
    try {
      await this.notifications.notify(userId, type, { type: 'catalog_ingredient', id });
    } catch (error) {
      this.logger.error({
        event: 'catalog_ingredient.notification_failed',
        type,
        ingredientId: id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** The same name twice, in another case or accents, would split the computed diets. */
  async assertNameFree(normalizedName: string, except?: string) {
    const taken = await this.nameHolder(normalizedName, except);
    if (taken) throw alreadyListed(taken);
  }

  /**
   * The common, non-merged entry holding this name, if any: by its stored key, or
   * (I2) a lot 2 entry whose key is still NULL, by its name normalized here. The
   * go-live order imports the list before the reprise fills those keys (spec §12).
   */
  async nameHolder(
    normalizedName: string,
    except?: string,
  ): Promise<{ id: string; name: string } | null> {
    const scope = {
      chefProfileId: null,
      status: { not: 'merged' },
      ...(except && { id: { not: except } }),
    };
    const taken = await this.prisma.catalogIngredient.findFirst({
      where: { normalizedName, ...scope },
      select: { id: true, name: true },
    });
    if (taken) return taken;
    const legacy = (await this.prisma.catalogIngredient.findMany({
      where: { normalizedName: null, ...scope },
      select: { id: true, name: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })) as { id: string; name: string }[];
    return legacy.find((row) => normalizeName(row.name) === normalizedName) ?? null;
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
  async toWrite(payload: UpdateCatalogIngredientDto) {
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
      // Annex order, once each: a line copies this list as stored (Recettes §5.2), so
      // one order keeps every stamp equal to a fresh composition, and a reorder is no
      // change.
      data.allergens = inAnnexOrder(payload.allergens);
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

/**
 * Ruling R28: the carry of the entry into the recipes is due from now. Written in the
 * transaction of the change that needs it; only the carry, or a replay, ending with
 * no failed dish clears it (`IngredientPropagationService`).
 */
export function markCarryPending(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<{ carryPendingAt: Date | null }> {
  return tx.catalogIngredient.update({
    where: { id },
    data: { carryPendingAt: new Date() },
    select: { carryPendingAt: true },
  });
}

/** The entry is no longer a chef's pending one: ruled on, or changed, meanwhile. */
export const notPending = () =>
  new UnprocessableEntityException({
    code: 'INGREDIENT_NOT_PENDING',
    message: 'Only a chef’s pending ingredient can be validated, merged or changed.',
  });

export const isNotFound = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';

/** A status is the admin's to change on a common entry; a private one follows its chef. */
function assertCommon(row: { chefProfileId: string | null; status: string }) {
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

/**
 * Recettes §7.3: whether the save changed what recipe lines copy or compute. Diets
 * and months are compared as sets: their order never changes a recipe. The allergens
 * are compared in order: stored lists are canonical (annex order), so a legacy order
 * normalized by this save is a change the stamps must follow.
 */
export function carriedChanged(before: Carried, after: Carried): boolean {
  const sameSet = (a: readonly unknown[], b: readonly unknown[]) =>
    new Set(a).size === new Set(b).size && a.every((x) => b.includes(x));
  return (
    before.name !== after.name ||
    before.aisle !== after.aisle ||
    before.allergensNone !== after.allergensNone ||
    before.allergens.length !== after.allergens.length ||
    before.allergens.some((code, i) => code !== after.allergens[i]) ||
    !sameSet(before.diets, after.diets) ||
    !sameSet(before.seasonMonths, after.seasonMonths)
  );
}

/** Name, normalized name (accents never defeat a search) or another name. */
const matching = (term: string): Prisma.CatalogIngredientWhereInput => ({
  OR: [
    { name: { contains: term, mode: 'insensitive' } },
    { normalizedName: { contains: normalizeName(term) } },
    { aliases: { has: term.toLowerCase() } },
  ],
});

export const alreadyListed = (existing?: { id: string; name: string }) =>
  new ConflictException({
    code: 'INGREDIENT_ALREADY_LISTED',
    message: 'An ingredient of this name is already in the list.',
    ...(existing && { ingredient: { id: existing.id, name: existing.name } }),
  });
