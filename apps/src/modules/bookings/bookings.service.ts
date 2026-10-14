import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';

import { AuditService } from '../../common/audit/audit.service';
import {
  buildPaginationMeta,
  resolvePageBounds,
  type Paginated,
  type PaginationQueryDto,
} from '../../common/dto/pagination.dto';
import { parisHhmm, parisToday } from '../../common/paris-time';
import {
  Booking,
  BookingStatus,
  MealStatus,
  Prisma,
} from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AvailabilityService } from '../calendar/availability.service';
import { RECIPE_FIELDS } from '../catalog/catalog.service';
import { changedMeanwhile } from '../dishes/dishes.service';
import { CHEF_CESU_INFO_SELECT, toChefCesuInfo } from '../payments/chef-cesu-info';
import { rateInForce } from '../payments/commission-policy';
import { findCommissionBlock } from '../payments/commission-standing';
import type { CommissionRates } from '../payments/commission.util';
import { afterTaxCredit } from '../quotes/domain/quote.rules';
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
import {
  AdminBookingsQueryDto,
  AdminUpdateBookingDto,
  BookingMealDto,
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
  OR: [
    { status: 'succeeded' },
    { status: 'pending', method: { in: ['cesu', 'avance_immediate'] } },
  ],
} satisfies Prisma.PaymentWhereInput;

const UNPAID_HOLD = {
  status: 'pending',
  payments: { none: MONEY_IN },
} satisfies Prisma.BookingWhereInput;

const notFound = () =>
  new NotFoundException({ code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' });

const invalid = (message: string, code = 'VALIDATION_FAILED') =>
  new UnprocessableEntityException({ code, message });

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/** What `bookings` stores of a prestation's time, as the agenda reads it. */
const schedule = (startsAt: Date, endsAt: Date) => ({
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
 * A booking is created `pending`, priced here, and confirmed by its payment
 * (`settlePayment`), never by a PATCH except an admin's. Unpaid, it holds the
 * batch cooker's slot 72 h (`expireUnpaid`).
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
    const block = await findCommissionBlock(
      this.prisma,
      offer.chefProfileId,
      this.config.get<number>('payments.commissionDebitMaxAttempts', 3),
    );
    if (block) {
      throw new ConflictException({ code: 'COMMISSION_UNPAID', message: block.message });
    }
    const formule = dto.formuleId
      ? await this.prisma.formule.findFirst({
          where: { id: dto.formuleId, active: true },
        })
      : null;
    if (dto.formuleId && !formule) {
      throw invalid('This formule is not offered.', 'FORMULE_UNAVAILABLE');
    }
    if (dto.meals?.length) await this.assertMeals(offer.chefProfileId, dto.meals);

    const endsAt = new Date(dto.startsAt.getTime() + offer.durationMinutes * 60_000);
    // An admin books on support's word: the override is audited below.
    if (caller.role !== 'admin') {
      await this.availability.assertBookable(offer.chefProfileId, dto.startsAt, endsAt);
    }

    const price = formule?.priceTtc ?? offer.priceCents;
    const { id } = await this.withReference(now, (reference) =>
      this.prisma.booking.create({
        data: {
          reference,
          clientId,
          chefProfileId: offer.chefProfileId,
          serviceOfferId: offer.id,
          formuleId: formule?.id ?? null,
          ...schedule(dto.startsAt, endsAt),
          persons: dto.persons ?? null,
          addressLine: dto.addressLine ?? null,
          notes: dto.notes ?? null,
          shoppingByClient: dto.shoppingByClient ?? false,
          status: 'pending',
          priceCents: price,
          amountTtc: price,
          amountAfterTax: formule?.priceAfterTax ?? afterTaxCredit(price),
          currency: offer.currency,
          ...(dto.meals?.length && {
            bookingMeals: {
              create: dto.meals.map((meal) => ({
                mealId: meal.mealId,
                portions: meal.portions ?? 4,
              })),
            },
          }),
        },
        select: { id: true },
      }),
    );

    if (dto.meals?.length) {
      // The recipe versions it cooks from, pinned now (§9.2). Best-effort.
      await this.lists
        .pinRecipes(id)
        .catch((error: unknown) =>
          this.logger.error(`Recipes not pinned for booking ${id}`, String(error)),
        );
    }
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
      include: { serviceOffer: { select: { durationMinutes: true } } },
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
    if (meals?.length) await this.assertMeals(booking.chefProfileId, meals);

    await this.prisma
      .$transaction(async (tx) => {
        if (meals) {
          await tx.bookingMeal.deleteMany({ where: { bookingId: id } });
          await tx.bookingMeal.createMany({
            data: meals.map((meal) => ({
              bookingId: id,
              mealId: meal.mealId,
              portions: meal.portions ?? 4,
            })),
          });
        }
        // Only from the status read above: a payment or an admin acting meanwhile
        // is reloaded, never overwritten.
        await tx.booking.update({
          where: { id, status: booking.status },
          data: {
            ...fields,
            ...when,
            ...(moving && { status }),
            ...(moving &&
              status === 'cooking' &&
              !booking.arrivedAt && { arrivedAt: now }),
          },
        });
      })
      .catch(changedMeanwhile);

    if (meals) {
      await this.lists
        .regenerateForBooking(id)
        .catch((error: unknown) =>
          this.logger.error(`Shopping list not rebuilt for booking ${id}`, String(error)),
        );
    }
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
          fields: Object.entries(dto)
            .filter(([, value]) => value !== undefined)
            .map(([key]) => key),
        },
      });
    }
    return this.view(caller, id);
  }

  // ── The 72 h hold ─────────────────────────────────────────────────────────

  /**
   * An unpaid `pending` booking holds the batch cooker's slot 72 h. At 48 h both
   * sides are reminded, once; at 72 h it is cancelled and the slot freed. Safe on
   * several replicas: the reminder is claimed through `holdReminderSentAt`, the
   * cancellation only touches a booking still unpaid and `pending`.
   */
  @Cron(CronExpression.EVERY_HOUR, { name: 'bookings-unpaid-hold' })
  async expireUnpaid(
    now: Date = new Date(),
  ): Promise<{ reminded: number; expired: number }> {
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
        await this.audit.record({
          actorType: 'system',
          action: 'booking.expired',
          subjectType: 'booking',
          subjectId: id,
          metadata: { reason: 'unpaid 72 h after booking' },
        });
      }

      if (reminded || expired) {
        this.logger.log(`Unpaid holds: ${reminded} reminded, ${expired} expired.`);
      }
      return { reminded, expired };
    } catch (error) {
      this.logger.error(
        'Unpaid hold job failed',
        error instanceof Error ? error.stack : String(error),
      );
      return { reminded: 0, expired: 0 };
    }
  }

  // ── Deprecated routes (`/bookings/…`), kept one release ──────────────────

  list(): Promise<Booking[]> {
    return this.prisma.booking.findMany({ orderBy: { startsAt: 'asc' } });
  }

  /** The caller's own bookings, as client or as batch cooker, one page at a time. */
  async listMine(
    clerkUserId: string,
    query: PaginationQueryDto = {},
  ): Promise<Paginated<Booking>> {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    const bounds = resolvePageBounds(query);
    const where = {
      OR: [{ clientId: user.id }, { chefProfile: { userId: user.id } }],
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({
        where,
        orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
        skip: bounds.skip,
        take: bounds.take,
      }),
      this.prisma.booking.count({ where }),
    ]);
    return { data, meta: buildPaginationMeta(bounds, total) };
  }

  async getMyBookingDetail(clerkUserId: string, bookingId: string) {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    // `chefCesu`: a client paying in prefinanced CESU must add the batch cooker as an
    // intervenant on their issuer's portal, with this number, before they can pay.
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, clientId: user.id },
      include: {
        // The client gets the recipe on the fiche, after the prestation (FLOW-02 §8).
        bookingMeals: {
          include: { meal: { omit: RECIPE_FIELDS } },
        },
        shoppingList: { include: { items: true } },
        chefProfile: { select: CHEF_CESU_INFO_SELECT },
      },
    });
    if (!booking) {
      return null;
    }

    const { chefProfile, ...rest } = booking;
    return { ...rest, chefCesu: toChefCesuInfo(chefProfile) };
  }

  getAdminBookingDetail(bookingId: string) {
    return this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        client: true,
        bookingMeals: { include: { meal: true } },
        shoppingList: { include: { items: true } },
      },
    });
  }

  // ── Internals ─────────────────────────────────────────────────────────────

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
