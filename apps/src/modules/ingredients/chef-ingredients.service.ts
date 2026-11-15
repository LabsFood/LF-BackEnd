import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ChefContentService } from '../dishes/chef-content.service';
import { ingredientCapReached } from '../dishes/domain/content.errors';
import { normalizeName } from './domain/ingredient.rules';
import { ChefIngredientDto, UpdateChefIngredientDto } from './dto/chef-ingredient.dto';
import { IngredientPropagationService } from './ingredient-propagation.service';
import {
  alreadyListed,
  CARRIED,
  Carried,
  carriedChanged,
  IngredientsService,
  isNotFound,
  markCarryPending,
  notPending,
  toPublic,
} from './ingredients.service';

/** "Not filled in" is no answer for an allergen: list them, or declare none. */
const allergensRequired = (
  Exception: typeof BadRequestException | typeof UnprocessableEntityException,
) =>
  new Exception({
    code: 'ALLERGENS_REQUIRED',
    message: 'List the allergens of this ingredient, or declare that it has none.',
  });

/** Recettes §7.1: creations per chef over a sliding 24 hours. */
const DAILY_CAP = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Recettes §7.1: a chef adds an ingredient when the common list lacks one. It is
 * private (only its chef links it) and pending until Lab's Food validates it, merges
 * it into a common one, or corrects it first (§7.2, `IngredientsService`).
 */
@Injectable()
export class ChefIngredientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chefs: ChefContentService,
    private readonly ingredients: IngredientsService,
    private readonly propagation: IngredientPropagationService,
  ) {}

  async create(clerkUserId: string, payload: ChefIngredientDto) {
    const chef = await this.chefs.chef(clerkUserId);
    this.chefs.assertVerified(chef);
    // "Not filled in" is no answer for an allergen: the chef lists them or says none.
    if (!payload.allergens?.length && payload.allergensNone !== true) {
      throw allergensRequired(BadRequestException);
    }
    const data = (await this.ingredients.toWrite(
      payload,
    )) as Prisma.CatalogIngredientUncheckedCreateInput;
    const normalized = data.normalizedName as string;
    await this.assertNameAvailable(chef.id, data.name, normalized);

    // Counted by author, so a chef cannot flood the list (and Lab's Food's review
    // queue). Count then create: concurrent creates can exceed the cap by a few.
    const recent = await this.prisma.catalogIngredient.count({
      where: {
        createdByUserId: chef.userId,
        createdAt: { gt: new Date(Date.now() - DAY_MS) },
      },
    });
    if (recent >= DAILY_CAP) throw ingredientCapReached();

    const row = await this.prisma.catalogIngredient
      .create({
        data: {
          ...data,
          status: 'pending',
          chefProfileId: chef.id,
          createdByUserId: chef.userId,
        },
      })
      .catch((error: unknown) => this.raced(error, chef.id, normalized));
    return toPublic(row);
  }

  /** Everything the chef created, whatever its status; a merged one names its target. */
  async listMine(clerkUserId: string) {
    const chef = await this.chefs.chef(clerkUserId);
    const rows = await this.prisma.catalogIngredient.findMany({
      where: { createdByUserId: chef.userId },
      orderBy: { createdAt: 'desc' },
      include: { mergedInto: { select: { id: true, name: true } } },
    });
    return rows.map((row) => toPublic(row));
  }

  /**
   * Only while the entry is pending. Another chef's entry is reported missing, never
   * revealed. A change a recipe line copies is carried into the chef's dishes (§7.3).
   */
  async update(clerkUserId: string, id: string, payload: UpdateChefIngredientDto) {
    const chef = await this.chefs.chef(clerkUserId);
    this.chefs.assertVerified(chef);
    const before = (await this.prisma.catalogIngredient.findUnique({
      where: { id },
      select: { ...CARRIED, chefProfileId: true, createdByUserId: true, status: true },
    })) as
      | (Carried & {
          chefProfileId: string | null;
          createdByUserId: string | null;
          status: string;
        })
      | null;
    const own =
      before !== null &&
      (before.chefProfileId === chef.id || before.createdByUserId === chef.userId);
    if (!before || !own) throw new NotFoundException('Ingredient not found.');
    // A validated entry is Lab's Food's now; a merged one is gone.
    if (before.status !== 'pending' || before.chefProfileId !== chef.id) {
      throw notPending();
    }

    const data = await this.ingredients.toWrite(payload);
    // The saved state must stay complete: allergens listed, or "none" (as on create).
    const allergens = (data.allergens as string[] | undefined) ?? before.allergens;
    const none = (data.allergensNone as boolean | undefined) ?? before.allergensNone;
    if (!allergens.length && !none) throw allergensRequired(UnprocessableEntityException);
    const normalized = data.normalizedName as string | undefined;
    if (normalized) {
      await this.assertNameAvailable(chef.id, data.name as string, normalized, id);
    }
    const { row, carried } = await this.prisma
      .$transaction(async (tx) => {
        const written = await tx.catalogIngredient.update({
          // The state read: validated or merged by Lab's Food since, the write finds
          // nothing.
          where: { id, chefProfileId: chef.id, status: 'pending' },
          data,
        });
        const due = carriedChanged(before, written);
        // Ruling R28: the carry into the chef's dishes is due, marked with the change.
        if (due) await markCarryPending(tx, id);
        return { row: written, carried: due };
      })
      .catch((error: unknown) => {
        if (isNotFound(error)) throw notPending();
        return this.raced(error, chef.id, normalized, id);
      });
    // Records its own audit entry, with its figures.
    if (carried) {
      await this.propagation.propagate([id], { type: 'chef', userId: chef.userId });
    }
    return toPublic(row);
  }

  /**
   * 409 with the entry in the way: a common one of that name or other name (the chef
   * links the common one), or one of the chef's own pending entries.
   */
  private async assertNameAvailable(
    chefProfileId: string,
    name: string | undefined,
    normalizedName: string,
    except?: string,
  ) {
    await this.ingredients.assertNameFree(normalizedName, except);
    const typed = (name ?? '').trim().toLowerCase();
    const sameAlias = await this.prisma.catalogIngredient.findFirst({
      where: {
        chefProfileId: null,
        status: { not: 'merged' },
        // Aliases are stored in lowercase; the folded form catches the accent-less ones.
        aliases: { hasSome: [...new Set([typed, normalizeName(typed)])] },
        ...(except && { id: { not: except } }),
      },
      select: { id: true, name: true },
    });
    if (sameAlias) throw alreadyListed(sameAlias);
    const ownPending = await this.prisma.catalogIngredient.findFirst({
      where: {
        chefProfileId,
        status: 'pending',
        normalizedName,
        ...(except && { id: { not: except } }),
      },
      select: { id: true, name: true },
    });
    if (ownPending) throw alreadyListed(ownPending);
  }

  /** The unique index answered first (a race): the same 409, with the entry that won. */
  private async raced(
    error: unknown,
    chefProfileId: string,
    normalizedName?: string,
    id?: string,
  ): Promise<never> {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = normalizedName
        ? await this.prisma.catalogIngredient.findFirst({
            where: {
              normalizedName,
              status: { not: 'merged' },
              OR: [{ chefProfileId: null }, { chefProfileId, status: 'pending' }],
              ...(id && { id: { not: id } }),
            },
            select: { id: true, name: true },
          })
        : null;
      throw alreadyListed(existing ?? undefined);
    }
    throw error;
  }
}
