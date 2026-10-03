import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { BookingStatus, UserRole } from '../../generated/prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ShoppingListsService } from '../shopping-lists/shopping-lists.service';
import { UsersService } from '../users/users.service';
import { COUNTRIES_TOTAL, country } from './domain/countries';
import { Line, scale } from './domain/recipes.rules';

type Role = 'chef' | 'admin' | 'client';

/**
 * A prestation's documents (FLOW-02 §7): the fiche recette and the shopping list.
 * A "mission" is a booking. §8 decides who sees what: the booking's batch cooker
 * reads and writes, admins read, the booking's client reads the shopping list,
 * and the fiche once the prestation is done. Anyone else is told it does not
 * exist.
 */
@Injectable()
export class MissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly lists: ShoppingListsService,
    private readonly audit: AuditService,
  ) {}

  private async access(clerkUserId: string, bookingId: string) {
    const user = await this.users.findByClerkId(clerkUserId);
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { bookingMeals: { include: { meal: true } } },
    });
    if (!user || !booking) throw new NotFoundException('No such prestation.');

    const chef = await this.prisma.chefProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    const role: Role | null =
      chef && booking.chefProfileId === chef.id
        ? 'chef'
        : user.role === UserRole.admin
          ? 'admin'
          : booking.clientId === user.id
            ? 'client'
            : null;
    if (!role) throw new NotFoundException('No such prestation.');
    return { user, booking, role };
  }

  private async asChef(clerkUserId: string, bookingId: string) {
    const context = await this.access(clerkUserId, bookingId);
    if (context.role !== 'chef') {
      throw new ForbiddenException({
        code: 'CONTENT_NOT_OWNED',
        message: 'Only the batch cooker of this prestation can change its documents.',
      });
    }
    return context;
  }

  /**
   * §7's fiche recette: the recipe pinned for this prestation, scaled to the
   * portions asked (by default those booked). When the chef has changed the recipe
   * since, the fiche says so with both version numbers, and still shows the one
   * cooked.
   */
  async recipeSheet(
    clerkUserId: string,
    bookingId: string,
    dishId: string,
    portions?: number,
  ) {
    const { booking, role } = await this.access(clerkUserId, bookingId);
    if (role === 'client' && booking.status !== BookingStatus.completed) {
      throw new ForbiddenException({
        code: 'NOT_YET_AVAILABLE',
        message: 'The recipe sheet is handed over after the prestation.',
      });
    }
    const pinned = (await this.lists.pinRecipes(bookingId)).find(
      (p) => p.mealId === dishId,
    );
    // §8: a recipe goes to no other chef. A prestation cooks its chef's dishes or
    // Lab's Food's; anything else is refused, whoever asks, except admins.
    const foreign =
      pinned?.meal.chefProfileId && pinned.meal.chefProfileId !== booking.chefProfileId;
    if (!pinned || (foreign && role !== 'admin')) {
      throw new NotFoundException('This dish is not part of this prestation.');
    }

    const { meal, recipe } = pinned;
    const servings = portions ?? pinned.portions;
    return {
      missionId: booking.id,
      dish: {
        id: meal.id,
        name: meal.name,
        country: meal.country,
        category: meal.category,
        diets: meal.dietaryTags,
        customDiets: meal.customDiets,
        allergens: meal.allergens,
        allergensNone: meal.allergensNone,
        customAllergens: meal.customAllergens,
      },
      portions: servings,
      recipe: {
        ingredients: scale(recipe.ingredients, recipe.portions, servings),
        steps: recipe.steps,
        reheating: recipe.reheating,
        storage: recipe.storage,
      },
      version: {
        pinned: recipe.version,
        current: meal.recipeVersion,
        newerAvailable: meal.recipeVersion > recipe.version,
      },
    };
  }

  /** §7's shopping list, for the chef, the admins and the booking's client. */
  async shoppingList(clerkUserId: string, bookingId: string) {
    const { booking } = await this.access(clerkUserId, bookingId);
    return this.withMission(booking, await this.lists.view(bookingId));
  }

  /** The chef's corrections: they survive every recalculation. */
  async correctShoppingList(clerkUserId: string, bookingId: string, lines: Line[]) {
    const { booking } = await this.asChef(clerkUserId, bookingId);
    return this.withMission(booking, await this.lists.correct(bookingId, lines));
  }

  async resetShoppingList(clerkUserId: string, bookingId: string) {
    const { booking } = await this.asChef(clerkUserId, bookingId);
    return this.withMission(booking, await this.lists.reset(bookingId));
  }

  /**
   * §9.2 as the PRD settled it: before the prestation, the chef may move it to
   * their current recipes, deliberately. It is recorded, and the shopping list is
   * recomputed (corrections kept).
   */
  async repin(clerkUserId: string, bookingId: string) {
    const { user, booking } = await this.asChef(clerkUserId, bookingId);
    if (booking.startsAt <= new Date()) {
      throw new ConflictException({
        code: 'PRESTATION_STARTED',
        message: 'The prestation has started: its recipes stay as they were.',
      });
    }
    const before = booking.bookingMeals.map((bm) => ({
      mealId: bm.mealId,
      version: bm.recipeVersion,
    }));
    const pinned = await this.lists.pinRecipes(bookingId, { repin: true });
    await this.lists.regenerateForBooking(bookingId);
    await this.audit.record({
      actorType: 'chef',
      actorUserId: user.id,
      action: 'recipes.repinned',
      subjectType: 'booking',
      subjectId: bookingId,
      metadata: {
        before,
        after: pinned.map((p) => ({ mealId: p.mealId, version: p.recipe.version })),
      },
    });
    return this.withMission(booking, await this.lists.view(bookingId));
  }

  /**
   * §5.3: the countries a client has tasted, from prestations actually done. A
   * cancelled or upcoming one colours nothing. Countries are keyed both ways, as
   * the world map needs the numeric code.
   */
  async culinaryMap(clerkUserId: string) {
    const user = await this.users.findByClerkId(clerkUserId);
    if (!user) return { total: COUNTRIES_TOTAL, explored: [] };
    const bookings = await this.prisma.booking.findMany({
      where: { clientId: user.id, status: BookingStatus.completed },
      orderBy: { startsAt: 'asc' },
      select: {
        startsAt: true,
        bookingMeals: { select: { meal: { select: { name: true, country: true } } } },
      },
    });

    const explored = new Map<
      string,
      NonNullable<ReturnType<typeof country>> & { firstTastedAt: Date; dishes: string[] }
    >();
    for (const booking of bookings) {
      for (const { meal } of booking.bookingMeals) {
        const place = country(meal.country);
        if (!place) continue;
        const entry = explored.get(place.code);
        if (!entry) {
          explored.set(place.code, {
            ...place,
            firstTastedAt: booking.startsAt,
            dishes: [meal.name],
          });
        } else if (!entry.dishes.includes(meal.name)) {
          entry.dishes.push(meal.name);
        }
      }
    }
    return { total: COUNTRIES_TOTAL, explored: [...explored.values()] };
  }

  private withMission(
    booking: { id: string; persons: number | null },
    list: { generatedAt: Date; groups: unknown },
  ) {
    return { missionId: booking.id, persons: booking.persons, ...list };
  }
}
