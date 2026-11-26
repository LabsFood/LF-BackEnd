import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SentryCron } from '@sentry/nestjs';

import { AuditService } from '../../common/audit/audit.service';
import { stackOf } from '../../common/logging/app-logger';
import { currentRequest } from '../../common/logging/request-context';
import { buildPaginationMeta, resolvePageBounds } from '../../common/dto/pagination.dto';
import { parisHhmm, parisToday } from '../../common/paris-time';
import {
  BookingStatus,
  MealStatus,
  type PaymentMethod,
  Prisma,
} from '../../generated/prisma/client';
import { GeoService } from '../../integrations/geo.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CLIENT_ALLERGY_SELECT,
  checkable,
  conflicts,
  DISH_ALLERGEN_SELECT,
  menuRefusal,
} from '../allergies/domain/allergies.rules';
import { AvailabilityService } from '../calendar/availability.service';
import { changedMeanwhile } from '../dishes/dishes.service';
import { menuFrozen } from '../dishes/domain/content.errors';
import { householdPortions } from '../dishes/domain/recipes.rules';

/** A dish booked for a client without a household on file. */
const DEFAULT_PORTIONS = 4;
import { OFFERED_METHODS_SELECT, offeredMethods } from '../payments/chef-cesu-info';
import { rateInForce } from '../payments/commission-policy';
import { assertNoCommissionBlock } from '../payments/commission-standing';
import type { CommissionRates } from '../payments/commission.util';
import { NotificationsService } from '../notifications/notifications.service';
import { shoppingDeadline } from '../shopping-lists/domain/shopping-list.rules';
import { ShoppingListsService } from '../shopping-lists/shopping-lists.service';
import { UsersService } from '../users/users.service';
import { BookingsMailer } from './bookings.mailer';
import {
  Audience,
  BOOKING_DETAIL_INCLUDE,
  BOOKING_LIST_INCLUDE,
  toBookingDetail,
  toBookingListItem,
} from './bookings.views';
import { ARRIVAL_WINDOW_MS, canTransition } from './domain/booking-status';
import { contractConsentRequired } from './domain/contract.errors';
import { frozenSince, isMenuFrozen } from './domain/menu-freeze.rules';
import { mealCountProblem } from './domain/meal-count.rules';
import {
  acceptedConsents,
  chefShops,
  consentsAuditMetadata,
  contractGaps,
  mandateProof,
  mergeConsents,
  type ContractState,
} from './domain/contract.rules';
import {
  ACCEPT_WINDOW_MS,
  CARD_WAIT_MS,
  methodProblem,
  type MethodProblem,
} from './domain/booking-request.rules';
import {
  bookingAmounts,
  reprice,
  shoppingFee,
  supplementRulesInForce,
  supplementsFor,
} from './domain/pricing';
import {
  AdminBookingsQueryDto,
  AdminUpdateBookingDto,
  BookingMealDto,
  ContractConsentsDto,
  ReplaceMealDto,
  NewBookingDto,
} from './dto/bookings.dto';

type Caller =
  | { role: 'client'; userId: string }
  | { role: 'chef'; userId: string; chefProfileId: string }
  | { role: 'admin'; userId: string };

const HOUR_MS = 60 * 60 * 1000;
/** An unpaid `pending` booking holds its slot this long… */
export const HOLD_MS = 72 * HOUR_MS;
/** …and both sides are reminded when this much has passed. */
export const REMIND_AFTER_MS = 48 * HOUR_MS;

/**
 * Money that came in, or is on its way: a settled payment, or a CESU declaration or
 * an URSSAF request waiting for its answer. A card intent left `pending` is not:
 * an abandoned one stays `pending` for ever (`coveredAmount`).
 */
const MONEY_IN = {
  // The prestation's money: a courses hold (lot 6) is released with the booking.
  purpose: 'service',
  OR: [
    { status: 'succeeded' },
    { status: 'pending', method: { in: ['cesu', 'avance_immediate'] } },
  ],
} satisfies Prisma.PaymentWhereInput;

const UNPAID_HOLD = {
  status: 'pending',
  // A CGV V1 request waits for the batch cooker, not for a payment.
  paymentMethod: null,
  payments: { none: MONEY_IN },
} satisfies Prisma.BookingWhereInput;

/** Addressed to the client, in French: the screen shows them as written. */
const METHOD_PROBLEM_MESSAGES: Record<MethodProblem, string> = {
  METHOD_NOT_OFFERED: 'Ce batch cooker n’accepte pas ce moyen de paiement.',
  CARD_NOT_AVAILABLE:
    'Ce batch cooker ne peut pas encore recevoir de paiement : réservation impossible pour le moment.',
  URSSAF_LINK_REFUSED: 'L’URSSAF a refusé le rattachement à ce batch cooker.',
  URSSAF_LINK_NONE:
    'L’avance immédiate demande un rattachement à ce batch cooker, à faire une fois avant de réserver.',
  URSSAF_DOSSIER_MISSING:
    'L’avance immédiate demande d’abord votre dossier URSSAF (identité, coordonnées bancaires).',
};

const notFound = () =>
  new NotFoundException({ code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' });

const invalid = (message: string, code = 'VALIDATION_FAILED') =>
  new UnprocessableEntityException({ code, message });

/**
 * The dishes against the offer's fixed count (`MEAL_COUNT_MISMATCH`, naming the
 * count, or `EXTRA_MEALS_NOT_OFFERED`); nothing to check on an offer without one.
 */
const assertMealCount = (
  mealsIncluded: number | null,
  chosen: number,
  extraMeals: number,
) => {
  const problem = mealCountProblem(mealsIncluded, chosen, extraMeals);
  if (problem === 'EXTRA_MEALS_NOT_OFFERED') {
    throw invalid('This offer is a fixed number of dishes: no extra dish.', problem);
  }
  if (problem) {
    throw new UnprocessableEntityException({
      code: problem,
      message: `This offer includes ${mealsIncluded} dishes: choose exactly that many.`,
      mealsIncluded,
    });
  }
};

/** The names of the fields a PATCH sent, for the log and the audit; never their values. */
const changedKeys = (dto: object) =>
  Object.entries(dto)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/** What `bookings` stores of a prestation's time, as the agenda reads it. */
export const schedule = (startsAt: Date, endsAt: Date) => ({
  startsAt,
  endsAt,
  bookingDate: parisToday(startsAt),
  timeSlot: `${parisHhmm(startsAt)}-${parisHhmm(endsAt)}`,
});

/**
 * Bookings, by audience: a client's own (`/me/bookings`), a batch cooker's
 * prestations (`/chef/bookings`), every booking (`/admin/bookings`). The audience's
 * filter is applied last to every query, so a booking outside it is a 404.
 *
 * A booking is created `pending` and priced here. A CGV V1 request (`paymentMethod`
 * set) is confirmed by the batch cooker's acceptance (`BookingRequestsService`); an
 * older one by its payment (`settlePayment`), unpaid holding the slot 72 h
 * (`expireUnpaid`). Never by a PATCH except an admin's.
 */
@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly lists: ShoppingListsService,
    private readonly availability: AvailabilityService,
    private readonly audit: AuditService,
    private readonly mailer: BookingsMailer,
    private readonly config: ConfigService,
    private readonly geo: GeoService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── By audience ───────────────────────────────────────────────────────────

  async listFor(role: Audience, clerkUserId: string, query: AdminBookingsQueryDto = {}) {
    const caller = await this.caller(role, clerkUserId);
    const bounds = resolvePageBounds(query);
    const where: Prisma.BookingWhereInput = {
      ...(query.status && { status: query.status }),
      ...((query.from || query.to) && {
        startsAt: {
          ...(query.from && { gte: query.from }),
          ...(query.to && { lt: query.to }),
        },
      }),
      ...(query.clientId && { clientId: query.clientId }),
      ...(query.chefId && { chefProfileId: query.chefId }),
      ...this.scope(caller),
    };
    // The agenda reads forward; a client and the back office want the latest first.
    const order = role === 'chef' ? 'asc' : 'desc';
    const [rows, total, rates] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        include: BOOKING_LIST_INCLUDE,
        orderBy: [{ startsAt: order }, { id: order }],
        skip: bounds.skip,
        take: bounds.take,
      }),
      this.prisma.booking.count({ where }),
      this.rates(role),
    ]);
    return {
      data: rows.map((row) => toBookingListItem(row, role, rates)),
      meta: buildPaginationMeta(bounds, total),
    };
  }

  async detailFor(role: Audience, clerkUserId: string, id: string) {
    return this.view(await this.caller(role, clerkUserId), id);
  }

  /**
   * A `pending` booking, priced here: the formule's price when one is chosen,
   * otherwise the offer's. A batch cooker books for a client they already know;
   * the client accepts by paying.
   */
  async create(
    role: Audience,
    clerkUserId: string,
    dto: NewBookingDto & { clientId?: string },
  ) {
    const caller = await this.caller(role, clerkUserId);
    const now = new Date();
    if (dto.startsAt.getTime() <= now.getTime()) {
      throw invalid('`startsAt` must be in the future.');
    }

    const offer = await this.prisma.serviceOffer.findFirst({
      where: {
        id: dto.serviceOfferId,
        isActive: true,
        chefProfile: { isActive: true, isVerified: true },
        ...(caller.role === 'chef' && { chefProfileId: caller.chefProfileId }),
      },
      select: {
        id: true,
        chefProfileId: true,
        durationMinutes: true,
        priceCents: true,
        currency: true,
        shoppingIncluded: true,
        shoppingFeeCents: true,
        mealsIncluded: true,
        chefProfile: { select: { userId: true } },
      },
    });
    if (!offer) {
      throw new NotFoundException({
        code: 'OFFER_NOT_FOUND',
        message: 'Offer not found.',
      });
    }

    const clientId = caller.role === 'client' ? caller.userId : dto.clientId!;
    if (caller.role !== 'client') {
      await this.assertClient(
        clientId,
        caller.role === 'chef' ? offer.chefProfileId : null,
      );
    }
    if (offer.chefProfile.userId === clientId) {
      throw new ConflictException({
        code: 'SAME_PERSON',
        message: 'A batch cooker cannot book themselves.',
      });
    }
    // An uncollected commission stops a batch cooker taking on new work.
    await assertNoCommissionBlock(
      this.prisma,
      offer.chefProfileId,
      this.config.get<number>('payments.commissionDebitMaxAttempts', 3),
    );
    const formule = dto.formuleId
      ? await this.prisma.formule.findFirst({
          where: { id: dto.formuleId, active: true },
        })
      : null;
    if (dto.formuleId && !formule) {
      throw invalid('This formule is not offered.', 'FORMULE_UNAVAILABLE');
    }
    assertMealCount(offer.mealsIncluded, dto.meals?.length ?? 0, dto.extraMeals ?? 0);
    let portions = DEFAULT_PORTIONS;
    if (dto.meals?.length) {
      await this.assertMeals(offer.chefProfileId, dto.meals);
      await this.assertAllergies(
        clientId,
        dto.meals.map((meal) => meal.mealId),
        [],
      );
      portions = await this.householdPortions(clientId, dto.meals);
    }
    await this.geo.assertCommune(dto.addressPostalCode, dto.addressCity, 'addressCity');
    await this.geo.checkStreet(dto.addressLine, dto.addressPostalCode, 'addressLine');
    const address = await this.bookingAddress(clientId, dto);

    // CGV V1 5.1 (decision of 2026-11-19): a client who names the method makes a
    // request the batch cooker accepts; nothing is charged before the session.
    const paymentMethod = caller.role === 'client' ? (dto.paymentMethod ?? null) : null;
    if (paymentMethod) {
      await this.assertPaymentMethod(offer.chefProfileId, clientId, paymentMethod);
    }

    // CGV art. 5.1: the client's boxes come with the booking. A batch cooker or an
    // admin cannot tick them: the client does, before paying (`assertPayable`).
    const consents: ContractState = acceptedConsents(
      caller.role === 'client' ? dto.consents : undefined,
      now,
    );
    if (caller.role === 'client') {
      const missing = contractGaps(consents, {
        chefShops: chefShops(offer, { shoppingByClient: dto.shoppingByClient ?? false }),
        startsAt: dto.startsAt,
        // Concluded at the latest when the hold ends (paid) or the batch cooker's delay
        // runs out (request): the 14 days start no later.
        latestConclusion: new Date(
          now.getTime() + (paymentMethod ? CARD_WAIT_MS + ACCEPT_WINDOW_MS : HOLD_MS),
        ),
        bookedAt: now,
      });
      if (missing.length) throw contractConsentRequired(missing, 'booking');
    }

    const endsAt = new Date(dto.startsAt.getTime() + offer.durationMinutes * 60_000);
    // An admin books on support's word: the override is audited below.
    if (caller.role !== 'admin') {
      await this.availability.assertBookable(offer.chefProfileId, dto.startsAt, endsAt);
    }

    // The offer's price (or the formule's), then each supplement on its own line.
    const amounts = bookingAmounts(
      formule?.priceTtc ?? offer.priceCents,
      supplementsFor(
        {
          persons: dto.persons,
          extraMeals: dto.extraMeals ?? 0,
          shoppingFeeCents: shoppingFee(offer, dto.shoppingByClient ?? false),
          formule: Boolean(formule),
        },
        await supplementRulesInForce(this.prisma),
      ),
      formule?.priceAfterTax,
    );
    const { id } = await this.withReference(now, (reference) =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.booking.create({
          data: {
            reference,
            clientId,
            chefProfileId: offer.chefProfileId,
            serviceOfferId: offer.id,
            formuleId: formule?.id ?? null,
            ...schedule(dto.startsAt, endsAt),
            persons: dto.persons ?? null,
            ...address,
            notes: dto.notes ?? null,
            shoppingByClient: dto.shoppingByClient ?? false,
            status: 'pending',
            paymentMethod,
            extraMeals: dto.extraMeals ?? 0,
            ...amounts,
            currency: offer.currency,
            ...consents,
            ...mandateProof(consents.deboursMandateAcceptedAt !== null, currentRequest()),
            ...(dto.meals?.length && {
              bookingMeals: {
                create: dto.meals.map((meal) => ({
                  mealId: meal.mealId,
                  portions: meal.portions ?? portions,
                })),
              },
            }),
          },
          select: { id: true },
        });
        // Recettes lot 3 (LF-0268): the menu is written, so each dish is pinned now,
        // version and allergens, in the same transaction.
        if (dto.meals?.length) await this.lists.pinRecipes(created.id, { db: tx });
        return created;
      }),
    );

    this.logger.log({
      event: 'booking.created',
      bookingId: id,
      chefProfileId: offer.chefProfileId,
      by: caller.role,
      meals: dto.meals?.length ?? 0,
      paymentMethod,
      amountTtc: amounts.amountTtc,
      extraPersonsCents: amounts.extraPersonsCents,
      extraMealsCents: amounts.extraMealsCents,
      shoppingFeeCents: amounts.shoppingFeeCents,
      ms: Date.now() - now.getTime(),
    });
    if (consents.contractVersion) await this.recordConsents(caller.userId, id, consents);
    if (caller.role === 'admin') {
      await this.audit.record({
        actorType: 'admin',
        actorUserId: caller.userId,
        action: 'booking.created',
        subjectType: 'booking',
        subjectId: id,
        metadata: {
          clientId,
          chefProfileId: offer.chefProfileId,
          availabilitySkipped: true,
        },
      });
    }
    return this.view(caller, id);
  }

  /**
   * Details, while `pending` and only by the client (or an admin, any time), and
   * the status, as `canTransition` allows. A batch cooker's DTO carries the
   * status only: a batch cooker who wants another time cancels and books again.
   */
  async update(
    role: Audience,
    clerkUserId: string,
    id: string,
    dto: AdminUpdateBookingDto,
  ) {
    const caller = await this.caller(role, clerkUserId);
    const booking = await this.prisma.booking.findFirst({
      where: { id, ...this.scope(caller) },
      include: {
        serviceOffer: {
          select: {
            durationMinutes: true,
            shoppingIncluded: true,
            shoppingFeeCents: true,
            mealsIncluded: true,
          },
        },
        quote: { select: { allergies: true } },
      },
    });
    if (!booking) throw notFound();

    const admin = caller.role === 'admin';
    const now = new Date();
    const { status, meals, startsAt, ...fields } = dto;
    const changesDetails =
      meals !== undefined ||
      startsAt !== undefined ||
      Object.values(fields).some((value) => value !== undefined);
    if (changesDetails && !admin && booking.status !== 'pending') {
      throw new ConflictException({
        code: 'BOOKING_LOCKED',
        message: 'Only a pending booking can be changed. Cancel it, or ask Lab’s Food.',
      });
    }

    // The town must be a commune of the postcode; the half not sent is the one booked.
    if (fields.addressCity !== undefined || fields.addressPostalCode !== undefined) {
      await this.geo.assertCommune(
        fields.addressPostalCode ?? booking.addressPostalCode,
        fields.addressCity ?? booking.addressCity,
        'addressCity',
      );
    }

    // Recettes lot 3 (LF-0269, R40): 72 hours before the start the dishes no longer
    // change. A Lab's Food admin may still, for support, and it is recorded below.
    const frozenMenuEdit = meals !== undefined && isMenuFrozen(booking.startsAt, now);
    if (meals !== undefined || fields.extraMeals !== undefined) {
      assertMealCount(
        booking.serviceOffer.mealsIncluded,
        meals?.length ?? 0,
        fields.extraMeals ?? booking.extraMeals,
      );
    }
    if (frozenMenuEdit && !admin) throw menuFrozen(frozenSince(booking.startsAt));

    const moving = status !== undefined && status !== booking.status;
    if (moving) await this.assertMove(caller, booking, status, now);

    let when: ReturnType<typeof schedule> | undefined;
    if (startsAt) {
      if (!admin && startsAt.getTime() <= now.getTime()) {
        throw invalid('`startsAt` must be in the future.');
      }
      const endsAt = new Date(
        startsAt.getTime() + booking.serviceOffer.durationMinutes * 60_000,
      );
      if (!admin) {
        await this.availability.assertBookable(
          booking.chefProfileId,
          startsAt,
          endsAt,
          id,
        );
      }
      when = schedule(startsAt, endsAt);
    }
    let portions = DEFAULT_PORTIONS;
    if (meals?.length) {
      await this.assertMeals(booking.chefProfileId, meals);
      await this.assertAllergies(
        booking.clientId,
        meals.map((meal) => meal.mealId),
        booking.quote?.allergies ?? [],
      );
      portions = await this.householdPortions(booking.clientId, meals);
    }
    // Each supplement follows only what changed: the base price, and any line the
    // client did not touch, stay as booked.
    const shoppingSwitched =
      fields.shoppingByClient !== undefined &&
      fields.shoppingByClient !== booking.shoppingByClient;
    const persons = fields.persons !== undefined ? fields.persons : booking.persons;
    const personsChanged = persons !== booking.persons;
    let repriced: ReturnType<typeof reprice> | undefined;
    const extraMeals = fields.extraMeals ?? booking.extraMeals;
    const extraMealsChanged = extraMeals !== booking.extraMeals;
    if (shoppingSwitched || personsChanged || extraMealsChanged) {
      const next = supplementsFor(
        {
          persons,
          extraMeals,
          shoppingFeeCents: shoppingFee(
            booking.serviceOffer,
            fields.shoppingByClient ?? false,
          ),
          formule: Boolean(booking.formuleId),
        },
        await supplementRulesInForce(this.prisma),
      );
      repriced = reprice(booking, {
        extraPersonsCents: personsChanged
          ? next.extraPersonsCents
          : booking.extraPersonsCents,
        extraMealsCents: extraMealsChanged
          ? next.extraMealsCents
          : booking.extraMealsCents,
        shoppingFeeCents: shoppingSwitched
          ? next.shoppingFeeCents
          : booking.shoppingFeeCents,
      });
    }

    await this.prisma
      .$transaction(async (tx) => {
        if (meals) {
          await tx.bookingMeal.deleteMany({ where: { bookingId: id } });
          await tx.bookingMeal.createMany({
            data: meals.map((meal) => ({
              bookingId: id,
              mealId: meal.mealId,
              portions: meal.portions ?? portions,
            })),
          });
          // Recettes lot 3 (LF-0268): the new menu is pinned, version and allergens.
          await this.lists.pinRecipes(id, { db: tx });
        }
        // Only from the status read above: a payment or an admin acting meanwhile
        // is reloaded, never overwritten.
        await tx.booking.update({
          where: { id, status: booking.status },
          data: {
            ...fields,
            // An admin's explicit amounts win over the recomputed ones.
            ...(repriced && {
              extraPersonsCents: repriced.extraPersonsCents,
              extraMealsCents: repriced.extraMealsCents,
              shoppingFeeCents: repriced.shoppingFeeCents,
              amountTtc: fields.amountTtc ?? repriced.amountTtc,
              amountAfterTax: fields.amountAfterTax ?? repriced.amountAfterTax,
            }),
            ...when,
            ...(moving && { status }),
            ...(moving &&
              status === 'cooking' &&
              !booking.arrivedAt && { arrivedAt: now }),
          },
        });
      })
      .catch(changedMeanwhile);

    this.logger.log({
      event: moving && status === 'cancelled' ? 'booking.cancelled' : 'booking.updated',
      bookingId: id,
      chefProfileId: booking.chefProfileId,
      by: caller.role,
      from: booking.status,
      to: moving ? status : booking.status,
      fields: changedKeys(dto),
      ...(repriced && { repricedAmountTtc: fields.amountTtc ?? repriced.amountTtc }),
      ms: Date.now() - now.getTime(),
    });
    // Recettes lot 3 (LF-0272): the dishes are home, the conservation sheet is ready.
    if (moving && status === 'delivered') {
      await this.notifications
        .notify(booking.clientId, 'conservation.ready', { type: 'booking', id })
        .catch((error: unknown) =>
          this.logger.error(
            { event: 'booking.conservation_not_notified', bookingId: id },
            stackOf(error),
          ),
        );
    }
    // Custom requests (15/11): the express dishes cooked here can now be kept or dropped.
    if (moving && status === 'delivered') await this.askExpressDecision(id);
    if (meals) await this.refreshList(id, booking);
    if (admin) {
      await this.audit.record({
        actorType: 'admin',
        actorUserId: caller.userId,
        action: 'booking.updated',
        subjectType: 'booking',
        subjectId: id,
        metadata: {
          from: booking.status,
          to: moving ? status : booking.status,
          fields: changedKeys(dto),
          // Recettes lot 3: the admin changed the dishes of a frozen menu.
          ...(frozenMenuEdit && { menuFrozenOverride: true }),
        },
      });
    }
    return this.view(caller, id);
  }

  /**
   * R41: an allergy declared after the menu was validated puts a dish in conflict.
   * The client or the batch cooker swaps that dish for another, whatever the status
   * (a frozen menu included, lot 3); only a dish in conflict, and only for a safe one.
   */
  async replaceConflictingMeal(
    role: Audience,
    clerkUserId: string,
    id: string,
    dto: ReplaceMealDto,
  ) {
    const caller = await this.caller(role, clerkUserId);
    const booking = await this.prisma.booking.findFirst({
      where: { id, ...this.scope(caller) },
      select: {
        status: true,
        clientId: true,
        startsAt: true,
        chefProfileId: true,
        quote: { select: { allergies: true } },
        bookingMeals: {
          select: { portions: true, meal: { select: DISH_ALLERGEN_SELECT } },
        },
      },
    });
    if (!booking) throw notFound();
    if (['cancelled', 'completed', 'delivered'].includes(booking.status)) {
      throw new ConflictException({
        code: 'BOOKING_LOCKED',
        message: 'This prestation is over: its dishes no longer change.',
      });
    }
    const client = await this.prisma.clientProfile.findUnique({
      where: { userId: booking.clientId },
      select: CLIENT_ALLERGY_SELECT,
    });
    const extra = booking.quote?.allergies ?? [];
    const dishes = booking.bookingMeals.map((row) => row.meal);
    const clashing = client ? conflicts(checkable(client, extra).codes, dishes) : [];
    const from = booking.bookingMeals.find((row) => row.meal.id === dto.from);
    if (!from || !clashing.some((c) => c.mealId === dto.from)) {
      throw invalid(
        'Only a dish in conflict with the client’s allergies is replaced here.',
      );
    }
    if (dishes.some((dish) => dish.id === dto.to)) {
      throw invalid('This dish is already on the menu.');
    }
    await this.assertMeals(booking.chefProfileId, [{ mealId: dto.to }]);
    // The new dish alone: another dish still in conflict is replaced in its own turn.
    await this.assertAllergies(booking.clientId, [dto.to], extra);

    // Allowed on a frozen menu (lot 1, R41): only the dish in conflict moves, and the
    // new one is pinned at once (lot 3, LF-0268).
    await this.prisma.$transaction(async (tx) => {
      await tx.bookingMeal.delete({
        where: { bookingId_mealId: { bookingId: id, mealId: dto.from } },
      });
      await tx.bookingMeal.create({
        data: { bookingId: id, mealId: dto.to, portions: from.portions },
      });
      await this.lists.pinRecipes(id, { db: tx });
    });
    this.logger.log({
      event: 'booking.allergy_meal_replaced',
      bookingId: id,
      chefProfileId: booking.chefProfileId,
      by: caller.role,
    });
    await this.refreshList(id, booking);
    return this.view(caller, id);
  }

  /**
   * Recettes lot 4 (LF-0283): after a change of dishes the shopping list is
   * recomputed, and sent again to a client who already had one, who is told.
   * Best-effort: the menu is written, a list that failed is rebuilt on next use.
   */
  /**
   * Once delivered, the batch cooker is asked to keep or drop the express dishes
   * written for the custom request of this prestation (decision of 15/11). In the
   * application only. Best-effort: the delivery stands either way.
   */
  private async askExpressDecision(id: string) {
    try {
      const pending = await this.prisma.bookingMeal.count({
        where: {
          bookingId: id,
          meal: { expressQuoteId: { not: null }, expressDecision: null },
        },
      });
      if (pending === 0) return;
      const chef = await this.prisma.booking.findUnique({
        where: { id },
        select: { chefProfile: { select: { userId: true } } },
      });
      if (!chef?.chefProfile) return;
      await this.notifications.notify(chef.chefProfile.userId, 'express_dish.decide', {
        type: 'booking',
        id,
      });
    } catch (error) {
      this.logger.error(
        { event: 'booking.express_decision_not_asked', bookingId: id },
        stackOf(error),
      );
    }
  }

  private async refreshList(id: string, booking: { clientId: string; startsAt: Date }) {
    try {
      const version = await this.lists.refreshAfterMenuChange(
        id,
        shoppingDeadline(booking.startsAt),
      );
      if (version === null) return;
      this.logger.log({
        event: 'shopping_list.resent_after_menu_change',
        bookingId: id,
        version,
      });
      await this.notifications.notify(booking.clientId, 'shopping_list.updated', {
        type: 'booking',
        id,
      });
      await this.lists.announce(id, [booking.clientId]);
    } catch (error) {
      this.logger.error(
        { event: 'booking.shopping_list_not_rebuilt', bookingId: id },
        stackOf(error),
      );
    }
  }

  /**
   * CGV V1 5.1: the method must be one this batch cooker takes, and the card payable
   * with them, since every request saves one (7.2). The advance also needs the client
   * enrolled with this cook at URSSAF, a link under review being enough.
   */
  private async assertPaymentMethod(
    chefProfileId: string,
    clientId: string,
    method: PaymentMethod,
  ) {
    const chef = await this.prisma.chefProfile.findUniqueOrThrow({
      where: { id: chefProfileId },
      select: OFFERED_METHODS_SELECT,
    });
    const urssafMode = this.config.get<string>('urssaf.gateway', 'disabled');
    const offered = offeredMethods(chef, urssafMode);
    const link =
      method === 'avance_immediate'
        ? await this.prisma.urssafLink.findUnique({
            where: { clientId_chefProfileId: { clientId, chefProfileId } },
            select: { status: true },
          })
        : null;
    const dossierMissing =
      method === 'avance_immediate' &&
      urssafMode === 'manual' &&
      link?.status !== 'active' &&
      (await this.prisma.urssafClientDossier.count({ where: { userId: clientId } })) ===
        0;
    const problem = methodProblem(
      method,
      offered,
      (link?.status as 'pending' | 'active' | 'refused' | undefined) ?? null,
      dossierMissing,
    );
    if (problem) {
      this.logger.warn({
        event: 'booking.method_refused',
        chefProfileId,
        method,
        problem,
      });
      throw new UnprocessableEntityException({
        code: problem,
        message: METHOD_PROBLEM_MESSAGES[problem],
      });
    }
  }

  // ── The 72 h hold ─────────────────────────────────────────────────────────

  /**
   * An unpaid `pending` booking holds the batch cooker's slot 72 h. At 48 h both
   * sides are reminded, once; at 72 h it is cancelled and the slot freed. Safe on
   * several replicas: the reminder is claimed through `holdReminderSentAt`, the
   * cancellation only touches a booking still unpaid and `pending`.
   */
  @Cron(CronExpression.EVERY_HOUR, { name: 'bookings-unpaid-hold' })
  @SentryCron('bookings-unpaid-hold', {
    checkinMargin: 10,
    maxRuntime: 10,
    failureIssueThreshold: 2,
  })
  async expireUnpaid(
    now: Date = new Date(),
  ): Promise<{ reminded: number; expired: number }> {
    const started = Date.now();
    try {
      const expireBefore = new Date(now.getTime() - HOLD_MS);
      const due = await this.prisma.booking.findMany({
        where: {
          ...UNPAID_HOLD,
          holdReminderSentAt: null,
          createdAt: { lte: new Date(now.getTime() - REMIND_AFTER_MS), gt: expireBefore },
        },
        select: {
          id: true,
          reference: true,
          startsAt: true,
          createdAt: true,
          amountTtc: true,
          priceCents: true,
          client: { select: { email: true, fullName: true } },
          chefProfile: {
            select: {
              displayName: true,
              user: { select: { email: true, fullName: true } },
            },
          },
        },
      });
      let reminded = 0;
      for (const booking of due) {
        const claimed = await this.prisma.booking.updateMany({
          where: { id: booking.id, holdReminderSentAt: null },
          data: { holdReminderSentAt: now },
        });
        if (claimed.count !== 1) continue;
        reminded += 1;
        this.logger.log({ event: 'booking.hold_reminded', bookingId: booking.id });
        await this.mailer.holdReminder({
          reference: booking.reference,
          startsAt: booking.startsAt,
          freedAt: new Date(booking.createdAt.getTime() + HOLD_MS),
          amountTtcCents: booking.amountTtc ?? booking.priceCents,
          client: booking.client,
          chef: {
            ...booking.chefProfile.user,
            displayName: booking.chefProfile.displayName,
          },
        });
      }

      const stale = await this.prisma.booking.findMany({
        where: { ...UNPAID_HOLD, createdAt: { lte: expireBefore } },
        select: { id: true },
      });
      let expired = 0;
      for (const { id } of stale) {
        const done = await this.prisma.booking.updateMany({
          where: { id, ...UNPAID_HOLD },
          data: { status: 'cancelled' },
        });
        if (done.count !== 1) continue;
        expired += 1;
        this.logger.log({ event: 'booking.expired', bookingId: id });
        await this.audit.record({
          actorType: 'system',
          action: 'booking.expired',
          subjectType: 'booking',
          subjectId: id,
          metadata: { reason: 'unpaid 72 h after booking' },
        });
      }

      this.logger.log({
        event: 'job.unpaid_holds',
        reminded,
        expired,
        ms: Date.now() - started,
      });
      return { reminded, expired };
    } catch (error) {
      this.logger.error({ event: 'job.unpaid_holds_failed' }, stackOf(error));
      return { reminded: 0, expired: 0 };
    }
  }

  /**
   * The client ticks the booking boxes on a `pending` booking: one a batch cooker or
   * an admin made for them, or one whose time or shopping changed since. Boxes
   * already ticked stay as they were; every box still needed must be ticked now.
   */
  async consent(clerkUserId: string, id: string, dto: ContractConsentsDto) {
    const caller = await this.caller('client', clerkUserId);
    const now = new Date();
    const booking = await this.prisma.booking.findFirst({
      where: { id, ...this.scope(caller) },
      select: {
        status: true,
        startsAt: true,
        createdAt: true,
        shoppingByClient: true,
        contractVersion: true,
        cgvAcceptedAt: true,
        deboursMandateAcceptedAt: true,
        earlyExecutionRequestedAt: true,
        serviceOffer: { select: { shoppingIncluded: true } },
      },
    });
    if (!booking) throw notFound();
    if (booking.status !== 'pending') {
      throw new ConflictException({
        code: 'BOOKING_LOCKED',
        message: 'Only a pending booking takes the booking boxes.',
      });
    }

    const consents = mergeConsents(booking, acceptedConsents(dto, now));
    const missing = contractGaps(consents, {
      chefShops: chefShops(booking.serviceOffer, booking),
      startsAt: booking.startsAt,
      latestConclusion: new Date(
        Math.max(now.getTime(), booking.createdAt.getTime() + HOLD_MS),
      ),
      bookedAt: booking.createdAt,
    });
    if (missing.length) throw contractConsentRequired(missing, 'booking');

    await this.prisma.booking
      .update({
        where: { id, status: 'pending' },
        data: {
          ...consents,
          ...mandateProof(
            !booking.deboursMandateAcceptedAt &&
              consents.deboursMandateAcceptedAt !== null,
            currentRequest(),
          ),
        },
      })
      .catch(changedMeanwhile);
    if (consents.contractVersion) await this.recordConsents(caller.userId, id, consents);
    return this.view(caller, id);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** The proof of the boxes ticked: who, when, under which version and texts. */
  private async recordConsents(
    userId: string,
    bookingId: string,
    consents: ContractState,
  ) {
    this.logger.log({
      event: 'booking.consents_recorded',
      bookingId,
      version: consents.contractVersion,
      cgv: Boolean(consents.cgvAcceptedAt),
      deboursMandate: Boolean(consents.deboursMandateAcceptedAt),
      earlyExecution: Boolean(consents.earlyExecutionRequestedAt),
    });
    await this.audit.record({
      actorType: 'client',
      actorUserId: userId,
      action: 'booking.consents',
      subjectType: 'booking',
      subjectId: bookingId,
      metadata: consentsAuditMetadata(consents),
    });
  }

  private async caller(role: Audience, clerkUserId: string): Promise<Caller> {
    if (role === 'chef') {
      return { role, ...(await this.users.chefIdentity(clerkUserId)) };
    }
    const user =
      role === 'admin'
        ? await this.users.findByClerkId(clerkUserId)
        : await this.users.ensurePersistedFromClerk(clerkUserId);
    if (!user) throw new NotFoundException('Account not found.');
    return { role, userId: user.id };
  }

  /** The audience's filter, spread last into every `where`. */
  private scope(caller: Caller): Prisma.BookingWhereInput {
    if (caller.role === 'client') return { clientId: caller.userId };
    if (caller.role === 'chef') return { chefProfileId: caller.chefProfileId };
    return {};
  }

  private async view(caller: Caller, id: string) {
    const [booking, rates] = await Promise.all([
      this.prisma.booking.findFirst({
        where: { id, ...this.scope(caller) },
        include: BOOKING_DETAIL_INCLUDE,
      }),
      this.rates(caller.role),
    ]);
    if (!booking) throw notFound();
    return toBookingDetail(booking, caller.role, rates);
  }

  /** The rate a booking's next payment would be charged, for the net shown. */
  private async rates(role: Audience): Promise<CommissionRates | null> {
    if (role === 'client') return null;
    return {
      rateBps: await rateInForce(
        this.prisma,
        this.config.get<number>('payments.commissionRateBps', 1500),
      ),
      vatRateBps: this.config.get<number>('payments.commissionVatRateBps', 2000),
    };
  }

  private async assertMove(
    caller: Caller,
    booking: { id: string; status: BookingStatus; startsAt: Date },
    to: BookingStatus,
    now: Date,
  ) {
    if (!canTransition(caller.role, booking.status, to)) {
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        message: `A ${booking.status} booking cannot become ${to} that way.`,
      });
    }
    if (caller.role === 'admin') return;

    if (to === 'cancelled') {
      if (booking.status === 'confirmed' && booking.startsAt.getTime() <= now.getTime()) {
        throw new ConflictException({
          code: 'BOOKING_STARTED',
          message: 'This prestation has started: ask Lab’s Food to cancel it.',
        });
      }
      const paid = await this.prisma.payment.count({
        where: { bookingId: booking.id, ...MONEY_IN },
      });
      if (paid > 0) {
        // ponytail: no refund flow; an admin cancels and refunds by hand in Stripe
        // (see payments.service.ts). Build both when refunds are more than rare.
        throw new ConflictException({
          code: 'BOOKING_PAID',
          message:
            'A payment was made or is on its way: Lab’s Food cancels this booking.',
        });
      }
    }
    if (
      to === 'cooking' &&
      now.getTime() < booking.startsAt.getTime() - ARRIVAL_WINDOW_MS
    ) {
      throw new ConflictException({
        code: 'TOO_EARLY',
        message: 'The arrival can be recorded from 2 hours before the start.',
      });
    }
  }

  /** A batch cooker books for a client they already know: a booking or a thread. */
  private async assertClient(clientId: string, chefProfileId: string | null) {
    const clientNotFound = () =>
      new NotFoundException({ code: 'CLIENT_NOT_FOUND', message: 'Client not found.' });
    const client = await this.prisma.user.findFirst({
      where: { id: clientId, deletedAt: null },
      select: { id: true },
    });
    if (!client) throw clientNotFound();
    if (!chefProfileId) return;
    const [bookings, threads] = await Promise.all([
      this.prisma.booking.count({
        where: { clientId, chefProfileId, status: { not: 'cancelled' } },
      }),
      this.prisma.conversation.count({ where: { clientId, chefProfileId } }),
    ]);
    if (!bookings && !threads) throw clientNotFound();
  }

  /**
   * Fail-closed (Recettes lot 1): no menu until the client declared their allergies,
   * every dish declares its allergens, and none holds one of the client's. For every
   * caller, admins included: it is the client's health, not a permission.
   */
  private async assertAllergies(clientId: string, mealIds: string[], extra: string[]) {
    const [client, dishes] = await Promise.all([
      this.prisma.clientProfile.findUnique({
        where: { userId: clientId },
        select: CLIENT_ALLERGY_SELECT,
      }),
      this.prisma.meal.findMany({
        where: { id: { in: mealIds } },
        select: DISH_ALLERGEN_SELECT,
      }),
    ]);
    const refusal = menuRefusal(client, dishes, extra);
    if (refusal) throw refusal;
  }

  /**
   * Portions for a dish booked without any (Recettes §9.1, BLK-27): the client's
   * household, a child as half a portion. Read only when a dish needs it.
   */
  /**
   * Where the session happens: the address given, or else the client's own. A batch
   * cooker booking for a known client no longer types it (2026-11-19).
   */
  private async bookingAddress(
    clientId: string,
    dto: Pick<NewBookingDto, 'addressLine' | 'addressCity' | 'addressPostalCode'>,
  ) {
    if (dto.addressLine || dto.addressCity || dto.addressPostalCode) {
      return {
        addressLine: dto.addressLine ?? null,
        addressCity: dto.addressCity ?? null,
        addressPostalCode: dto.addressPostalCode ?? null,
      };
    }
    const profile = await this.prisma.clientProfile.findUnique({
      where: { userId: clientId },
      select: { addressStreet: true, addressCity: true, addressPostalCode: true },
    });
    return {
      addressLine: profile?.addressStreet ?? null,
      addressCity: profile?.addressCity ?? null,
      addressPostalCode: profile?.addressPostalCode ?? null,
    };
  }

  private async householdPortions(clientId: string, meals: BookingMealDto[]) {
    if (meals.every((meal) => meal.portions != null)) return DEFAULT_PORTIONS;
    const household = await this.prisma.clientProfile.findUnique({
      where: { userId: clientId },
      select: { householdAdults: true, householdKids: true },
    });
    return household
      ? householdPortions(household.householdAdults, household.householdKids)
      : DEFAULT_PORTIONS;
  }

  /** The batch cooker's published dishes, or Lab's Food's own. */
  private async assertMeals(chefProfileId: string, meals: BookingMealDto[]) {
    const found = await this.prisma.meal.count({
      where: {
        id: { in: meals.map((meal) => meal.mealId) },
        status: MealStatus.published,
        OR: [{ chefProfileId }, { chefProfileId: null, offeredToChefProfileId: null }],
      },
    });
    if (found !== meals.length) {
      throw invalid(
        'Each dish must be a published dish of this batch cooker or of Lab’s Food.',
        'MEAL_UNAVAILABLE',
      );
    }
  }

  /**
   * `LF-<year>-NNNN`, the next number of the year. Custom requests number theirs
   * `LF-SM-…` and are not counted.
   *
   * ponytail: count + 1, retried on a collision. Switch to a per-year sequence if
   * bookings ever contend for numbers.
   */
  private async withReference<T>(at: Date, create: (reference: string) => Promise<T>) {
    const prefix = `LF-${parisToday(at).getUTCFullYear()}-`;
    for (let attempt = 0; ; attempt += 1) {
      const taken = await this.prisma.booking.count({
        where: { reference: { startsWith: prefix } },
      });
      try {
        return await create(`${prefix}${String(taken + 1 + attempt).padStart(4, '0')}`);
      } catch (error) {
        if (attempt >= 4 || !isUniqueViolation(error)) throw error;
      }
    }
  }
}
