import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { BookingStatus, UserRole } from '../../generated/prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  listStatus,
  MarkInput,
  shoppingDeadline,
} from '../shopping-lists/domain/shopping-list.rules';
import { ShoppingListsService } from '../shopping-lists/shopping-lists.service';
import { UsersService } from '../users/users.service';
import { shoppingByClient, shoppingListFrozen } from './domain/content.errors';
import { COUNTRIES_TOTAL, country } from './domain/countries';
import { Line, readSteps, roundLines, scale } from './domain/recipes.rules';
import { PutDishNotesDto } from './dto/mission.dto';

type Role = 'chef' | 'admin' | 'client';

/** From the moment the chef is cooking: what was cooked is known and worth a note. */
const NOTES_OPEN: BookingStatus[] = [
  BookingStatus.cooking,
  BookingStatus.delivered,
  BookingStatus.completed,
];

/**
 * A prestation's documents (FLOW-02 §7): the fiche recette and the shopping list.
 * A "mission" is a booking. §8 decides who sees what: the booking's batch cooker
 * reads and writes, admins read, the booking's client reads the shopping list,
 * and the fiche once the prestation is done. Anyone else is told it does not
 * exist.
 */
@Injectable()
export class MissionsService {
  private readonly logger = new Logger(MissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly lists: ShoppingListsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
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

  private async asClient(clerkUserId: string, bookingId: string) {
    const context = await this.access(clerkUserId, bookingId);
    if (context.role !== 'client') {
      throw new ForbiddenException({
        code: 'CONTENT_NOT_OWNED',
        message: 'Only the client of this prestation can send its final shopping list.',
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
    const line = booking.bookingMeals.find((bm) => bm.mealId === dishId);
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
        ingredients: roundLines(scale(recipe.ingredients, recipe.portions, servings)),
        steps: readSteps(recipe.steps),
        // Not part of a version (Recettes §4.6): the advice as it stands today.
        reheating: meal.reheating,
        storage: recipe.storage,
      },
      // What the chef wrote of this dish in this prestation: beside the advice above.
      notes: {
        reheating: line?.reheatingNote ?? null,
        storage: line?.storageNote ?? null,
      },
      version: {
        pinned: recipe.version,
        current: meal.recipeVersion,
        newerAvailable: meal.recipeVersion > recipe.version,
      },
    };
  }

  /**
   * The chef's own words on a dish as cooked in this prestation: how to reheat it,
   * how to keep it. Tied to the prestation (the `booking_meals` row), never to the
   * recipe, which keeps its advice. Open once the chef is cooking; the client reads
   * them on the fiche when the prestation is done. A field left out stays, a blank
   * or null one is cleared.
   */
  async setDishNotes(
    clerkUserId: string,
    bookingId: string,
    dishId: string,
    dto: PutDishNotesDto,
  ) {
    const { booking } = await this.asChef(clerkUserId, bookingId);
    if (!booking.bookingMeals.some((bm) => bm.mealId === dishId)) {
      throw new NotFoundException('This dish is not part of this prestation.');
    }
    if (!NOTES_OPEN.includes(booking.status)) {
      throw new ConflictException({
        code: 'PRESTATION_NOT_STARTED',
        message: 'Notes on a dish are written once the prestation is under way.',
      });
    }
    const clean = (note: string | null) => note?.trim() || null;
    const data = {
      ...(dto.reheatingNote !== undefined && { reheatingNote: clean(dto.reheatingNote) }),
      ...(dto.storageNote !== undefined && { storageNote: clean(dto.storageNote) }),
    };
    const saved = await this.prisma.bookingMeal.update({
      where: { bookingId_mealId: { bookingId, mealId: dishId } },
      data,
      select: { reheatingNote: true, storageNote: true },
    });
    this.logger.log({ event: 'mission.dish_notes_saved', bookingId, dishId });
    return saved;
  }

  /**
   * §7's shopping list, for the chef, the admins and the booking's client. The
   * client starts again from their last answer while they can still send it; once
   * frozen, they see what counts, like everyone else.
   */
  async shoppingList(clerkUserId: string, bookingId: string) {
    const { booking, role } = await this.access(clerkUserId, bookingId);
    const editable = new Date() < shoppingDeadline(booking.startsAt);
    return this.withMission(
      booking,
      await this.lists.view(bookingId, { forClient: role === 'client' && editable }),
    );
  }

  /**
   * Recettes §10.7, case 1: the chef sends the list to the client, again after any
   * change they want the client to see. Until noon the day before.
   */
  async sendShoppingList(clerkUserId: string, bookingId: string) {
    const { booking } = await this.asChef(clerkUserId, bookingId);
    if (booking.shoppingByClient) throw shoppingByClient();
    const deadline = shoppingDeadline(booking.startsAt);
    if (new Date() >= deadline) throw shoppingListFrozen(deadline);

    const { version } = await this.lists.send(bookingId);
    this.logger.log({ event: 'shopping_list.sent', bookingId, version });
    await this.tell(
      booking.clientId,
      version > 1 ? 'shopping_list.updated' : 'shopping_list.sent',
      bookingId,
    );
    return this.withMission(booking, await this.lists.view(bookingId));
  }

  /**
   * The client's final list: what they already have and their comments, against
   * the version they had on screen. Resent as often as they like until the deadline.
   */
  async submitShoppingList(
    clerkUserId: string,
    bookingId: string,
    answer: { version: number; marks: MarkInput[] },
  ) {
    const { booking } = await this.asClient(clerkUserId, bookingId);
    if (booking.shoppingByClient) throw shoppingByClient();

    const { version, marks } = await this.lists.submit(
      bookingId,
      answer,
      shoppingDeadline(booking.startsAt),
    );
    // The count only: a comment is the client's words, and may say what they eat.
    this.logger.log({ event: 'shopping_list.final_received', bookingId, version, marks });
    const chef = await this.prisma.chefProfile.findUnique({
      where: { id: booking.chefProfileId },
      select: { userId: true },
    });
    if (chef) await this.tell(chef.userId, 'shopping_list.final_received', bookingId);
    return this.withMission(
      booking,
      await this.lists.view(bookingId, { forClient: true }),
    );
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

  /**
   * The bell, best effort: the list is sent or answered either way, and the other
   * side sees it on their page. A failure is logged, never thrown.
   */
  private async tell(userId: string, type: string, bookingId: string) {
    try {
      await this.notifications.notify(userId, type, { type: 'booking', id: bookingId });
    } catch (error) {
      this.logger.error({
        event: 'shopping_list.notify_failed',
        type,
        bookingId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private withMission(
    booking: {
      id: string;
      persons: number | null;
      startsAt: Date;
      shoppingByClient: boolean;
    },
    list: Awaited<ReturnType<ShoppingListsService['view']>>,
  ) {
    const deadline = shoppingDeadline(booking.startsAt);
    return {
      missionId: booking.id,
      persons: booking.persons,
      shoppingByClient: booking.shoppingByClient,
      deadline,
      status: listStatus(list, deadline, new Date()),
      ...list,
    };
  }
}
