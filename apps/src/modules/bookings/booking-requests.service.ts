import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SentryCron } from '@sentry/nestjs';
import type Stripe from 'stripe';

import { AuditService } from '../../common/audit/audit.service';
import { stackOf } from '../../common/logging/app-logger';
import type { PaymentMethod } from '../../generated/prisma/client';
import { StripeService } from '../../integrations/stripe.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BookingPaymentsService } from '../payments/booking-payments.service';
import { assertOwnSiteUrl } from '../payments/own-site-url';
import { bookingCoverage } from '../payments/payment-settlement';
import { PaymentsService } from '../payments/payments.service';
import { UsersService } from '../users/users.service';
import { BookingsMailer } from './bookings.mailer';
import { BookingsService } from './bookings.service';
import {
  CARD_WAIT_MS,
  acceptBy,
  chargeDueAt,
  settlementPlan,
} from './domain/booking-request.rules';
import { GOING_AHEAD } from './domain/booking-status';

const HOUR_MS = 60 * 60 * 1000;
/** A claim older than this is a crashed run: the job may take it again. */
const BATCH = 50;

const REQUEST_SELECT = {
  id: true,
  reference: true,
  status: true,
  clientId: true,
  chefProfileId: true,
  startsAt: true,
  endsAt: true,
  amountTtc: true,
  priceCents: true,
  paymentMethod: true,
  stripeCustomerId: true,
  cardSetupSessionId: true,
  cardSavedAt: true,
  requestedAt: true,
  acceptBy: true,
  acceptedAt: true,
  client: { select: { email: true, fullName: true } },
  chefProfile: {
    select: {
      displayName: true,
      userId: true,
      user: { select: { email: true, fullName: true } },
    },
  },
} as const;

const notFound = () =>
  new NotFoundException({ code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' });

const notARequest = () =>
  new ConflictException({
    code: 'NOT_A_REQUEST',
    message: 'This booking is not a request waiting for its card or its batch cooker.',
  });

/**
 * A CGV V1 direct booking, from the request to its payment (decision of 2026-11-19):
 * the card saved at booking (7.2), the batch cooker's answer within 48 h (5.2), and the
 * charge after the session (7.3). The rules are `domain/booking-request.rules.ts`; this
 * service only moves rows, Stripe and e-mails.
 *
 * Every write is claimed by an UPDATE on the state it leaves, so the jobs are safe on
 * several replicas and a webhook racing the client's return does the work once.
 */
@Injectable()
export class BookingRequestsService {
  private readonly logger = new Logger(BookingRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly stripe: StripeService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly mailer: BookingsMailer,
    private readonly bookings: BookingsService,
    private readonly payments: PaymentsService,
    private readonly bookingPayments: BookingPaymentsService,
  ) {}

  // ── The card (7.2) ────────────────────────────────────────────────────────

  /**
   * `POST /me/bookings/{id}/card`: a Stripe Checkout page in `setup` mode. Nothing is
   * charged; the card is kept for the charge after the session (or the fallback).
   */
  async startCard(
    clerkUserId: string,
    bookingId: string,
    urls: { successUrl: string; cancelUrl: string },
  ) {
    for (const url of [urls.successUrl, urls.cancelUrl]) {
      assertOwnSiteUrl(
        this.config,
        url,
        'successUrl and cancelUrl must point at a Lab’s Food site.',
      );
    }
    const booking = await this.ownRequest(clerkUserId, bookingId);
    if (booking.status !== 'pending' || booking.acceptedAt) throw notARequest();
    const client = this.client();
    const customerId = booking.stripeCustomerId ?? (await this.customerFor(booking));
    const session = await client.checkout.sessions.create({
      mode: 'setup',
      customer: customerId,
      currency: 'eur',
      payment_method_types: ['card'],
      setup_intent_data: {
        metadata: { bookingId: booking.id, purpose: 'booking_card' },
      },
      success_url: urls.successUrl,
      cancel_url: urls.cancelUrl,
      metadata: { bookingId: booking.id, purpose: 'booking_card' },
    });
    await this.prisma.booking.update({
      where: { id: booking.id },
      data: { stripeCustomerId: customerId, cardSetupSessionId: session.id },
    });
    this.logger.log({ event: 'booking.card_started', bookingId: booking.id });
    return { sessionId: session.id, url: session.url ?? '' };
  }

  /** `POST /me/bookings/{id}/card/confirm`: back from the setup page. */
  async confirmCard(clerkUserId: string, bookingId: string, sessionId: string) {
    const booking = await this.ownRequest(clerkUserId, bookingId);
    if (booking.cardSetupSessionId === sessionId) {
      const session = await this.client().checkout.sessions.retrieve(sessionId, {
        expand: ['setup_intent.payment_method'],
      });
      const intent = session.setup_intent as Stripe.SetupIntent | null;
      if (!intent || intent.status !== 'succeeded') {
        throw new ConflictException({
          code: 'CARD_NOT_SAVED',
          message: 'The card is not saved yet: finish the step on the card form.',
        });
      }
      await this.saveCard(booking.id, intent);
    } else if (!booking.cardSavedAt) {
      throw new ConflictException({
        code: 'CARD_SETUP_MISMATCH',
        message: 'This card setup is not the one of this booking.',
      });
    }
    return this.bookings.detailFor('client', clerkUserId, bookingId);
  }

  /** Webhook `setup_intent.succeeded` for a booking card: the same save, idempotent. */
  async handleSetupIntentSucceeded(intent: Stripe.SetupIntent): Promise<boolean> {
    if (intent.metadata?.purpose !== 'booking_card' || !intent.metadata.bookingId) {
      return false;
    }
    const full =
      typeof intent.payment_method === 'string'
        ? await this.client().setupIntents.retrieve(intent.id, {
            expand: ['payment_method'],
          })
        : intent;
    await this.saveCard(intent.metadata.bookingId, full);
    return true;
  }

  private async saveCard(bookingId: string, intent: Stripe.SetupIntent) {
    const method = intent.payment_method;
    if (!method || typeof method === 'string') {
      throw new ConflictException({
        code: 'CARD_NOT_SAVED',
        message: 'Stripe returned no card for this setup.',
      });
    }
    const now = new Date();
    await this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        stripePaymentMethodId: method.id,
        cardBrand: method.card?.brand ?? null,
        cardLast4: method.card?.last4 ?? null,
        cardSavedAt: now,
        cardSetupSessionId: intent.id,
      },
    });
    this.logger.log({ event: 'booking.card_saved', bookingId });

    // The first card sends the request to the batch cooker, once.
    const booking = await this.prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: REQUEST_SELECT,
    });
    if (booking.status !== 'pending' || booking.requestedAt) return;
    const deadline = acceptBy(now, booking.startsAt);
    const sent = await this.prisma.booking.updateMany({
      where: { id: bookingId, status: 'pending', requestedAt: null },
      data: { requestedAt: now, acceptBy: deadline },
    });
    if (sent.count !== 1) return;
    this.logger.log({ event: 'booking.requested', bookingId, acceptBy: deadline });
    await this.audit.record({
      actorType: 'client',
      actorUserId: booking.clientId,
      action: 'booking.requested',
      subjectType: 'booking',
      subjectId: bookingId,
      metadata: {
        paymentMethod: booking.paymentMethod,
        acceptBy: deadline.toISOString(),
      },
    });
    await this.tellChef(booking, deadline);
  }

  // ── The batch cooker's answer (5.2) ───────────────────────────────────────

  /**
   * `POST /chef/bookings/{id}/accept`: the contract is concluded now (the 14 days start,
   * the contract e-mail goes out). A card booking on short notice is charged at once.
   */
  async accept(clerkUserId: string, bookingId: string) {
    const { chefProfileId } = await this.users.chefIdentity(clerkUserId);
    const booking = await this.chefRequest(chefProfileId, bookingId);
    const now = new Date();
    if (booking.acceptBy && booking.acceptBy.getTime() <= now.getTime()) {
      throw new ConflictException({
        code: 'REQUEST_EXPIRED',
        message: 'The 48 hours to answer this request are over.',
      });
    }
    const done = await this.prisma.booking.updateMany({
      where: { id: bookingId, status: 'pending', acceptedAt: null, refusedAt: null },
      data: { status: 'confirmed', acceptedAt: now, concludedAt: now },
    });
    if (done.count !== 1) throw notARequest();
    this.logger.log({ event: 'booking.accepted', bookingId, chefProfileId });
    await this.audit.record({
      actorType: 'chef',
      actorUserId: booking.chefProfile.userId,
      action: 'booking.accepted',
      subjectType: 'booking',
      subjectId: bookingId,
    });
    await this.notify(booking.clientId, 'booking.accepted', bookingId);

    const due = chargeDueAt(
      booking.paymentMethod!,
      now,
      booking.startsAt,
      booking.endsAt,
    );
    if (due.getTime() <= now.getTime()) await this.settleOne(bookingId, now);
    return this.bookings.detailFor('chef', clerkUserId, bookingId);
  }

  /** `POST /chef/bookings/{id}/refuse`: nothing is charged (5.2). */
  async refuse(clerkUserId: string, bookingId: string, reason?: string) {
    const { chefProfileId } = await this.users.chefIdentity(clerkUserId);
    const booking = await this.chefRequest(chefProfileId, bookingId);
    const now = new Date();
    const done = await this.prisma.booking.updateMany({
      where: { id: bookingId, status: 'pending', acceptedAt: null, refusedAt: null },
      data: {
        status: 'cancelled',
        refusedAt: now,
        refusalReason: reason?.trim() || null,
      },
    });
    if (done.count !== 1) throw notARequest();
    this.logger.log({ event: 'booking.refused', bookingId, chefProfileId });
    await this.audit.record({
      actorType: 'chef',
      actorUserId: booking.chefProfile.userId,
      action: 'booking.refused',
      subjectType: 'booking',
      subjectId: bookingId,
    });
    await this.notify(booking.clientId, 'booking.refused', bookingId);
    await this.mailer.requestDeclined({
      reference: booking.reference,
      startsAt: booking.startsAt,
      client: booking.client,
      chefName: booking.chefProfile.displayName,
      reason: reason?.trim() || null,
      expired: false,
    });
    return this.bookings.detailFor('chef', clerkUserId, bookingId);
  }

  // ── The jobs ──────────────────────────────────────────────────────────────

  /**
   * Requests that wait: a card never saved is dropped after an hour; a batch cooker is
   * reminded halfway through their delay, once; at `acceptBy` the request expires and
   * the client is told nothing was charged.
   */
  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'bookings-requests' })
  @SentryCron('bookings-requests', {
    checkinMargin: 5,
    maxRuntime: 10,
    failureIssueThreshold: 2,
  })
  async expireRequests(now: Date = new Date()) {
    const started = Date.now();
    try {
      const abandoned = await this.prisma.booking.updateMany({
        where: {
          status: 'pending',
          paymentMethod: { not: null },
          requestedAt: null,
          createdAt: { lte: new Date(now.getTime() - CARD_WAIT_MS) },
        },
        data: { status: 'cancelled' },
      });

      const toRemind = await this.prisma.booking.findMany({
        where: {
          status: 'pending',
          paymentMethod: { not: null },
          requestedAt: { not: null, lte: new Date(now.getTime() - 24 * HOUR_MS) },
          acceptBy: { gt: now },
          holdReminderSentAt: null,
        },
        select: REQUEST_SELECT,
        take: BATCH,
      });
      let reminded = 0;
      for (const booking of toRemind) {
        const claimed = await this.prisma.booking.updateMany({
          where: { id: booking.id, holdReminderSentAt: null },
          data: { holdReminderSentAt: now },
        });
        if (claimed.count !== 1) continue;
        reminded += 1;
        await this.tellChef(booking, booking.acceptBy!);
      }

      const lapsed = await this.prisma.booking.findMany({
        where: {
          status: 'pending',
          paymentMethod: { not: null },
          acceptBy: { lte: now },
        },
        select: REQUEST_SELECT,
        take: BATCH,
      });
      let expired = 0;
      for (const booking of lapsed) {
        const done = await this.prisma.booking.updateMany({
          where: { id: booking.id, status: 'pending', acceptedAt: null },
          data: { status: 'cancelled' },
        });
        if (done.count !== 1) continue;
        expired += 1;
        await this.audit.record({
          actorType: 'system',
          action: 'booking.expired',
          subjectType: 'booking',
          subjectId: booking.id,
          metadata: { reason: 'not answered within 48 h (CGV 5.2)' },
        });
        await this.notify(booking.clientId, 'booking.expired', booking.id);
        await this.mailer.requestDeclined({
          reference: booking.reference,
          startsAt: booking.startsAt,
          client: booking.client,
          chefName: booking.chefProfile.displayName,
          reason: null,
          expired: true,
        });
      }
      this.logger.log({
        event: 'job.booking_requests',
        abandoned: abandoned.count,
        reminded,
        expired,
        ms: Date.now() - started,
      });
      return { abandoned: abandoned.count, reminded, expired };
    } catch (error) {
      this.logger.error({ event: 'job.booking_requests_failed' }, stackOf(error));
      return { abandoned: 0, reminded: 0, expired: 0 };
    }
  }

  /**
   * The charge after the session (7.3): the card off session, the advance sent to
   * URSSAF, a CESU client reminded then charged on the card 48 h later. One attempt per
   * booking (`autoChargedAt`); a refusal is the client's to settle on the payment
   * screen, within 48 h (7.5).
   */
  @Cron(CronExpression.EVERY_30_MINUTES, { name: 'bookings-charge-after' })
  @SentryCron('bookings-charge-after', {
    checkinMargin: 10,
    maxRuntime: 15,
    failureIssueThreshold: 2,
  })
  async settleDue(now: Date = new Date()) {
    const started = Date.now();
    try {
      // Short-notice card bookings fall due before the end: read 48 h ahead.
      const candidates = await this.prisma.booking.findMany({
        where: {
          paymentMethod: { not: null },
          acceptedAt: { not: null },
          autoChargedAt: null,
          status: { in: [...GOING_AHEAD, 'completed'] },
          startsAt: { lte: new Date(now.getTime() + 48 * HOUR_MS) },
        },
        select: { id: true },
        orderBy: { endsAt: 'asc' },
        take: BATCH,
      });
      const counts: Record<string, number> = {};
      for (const { id } of candidates) {
        const step = await this.settleOne(id, now);
        counts[step] = (counts[step] ?? 0) + 1;
      }
      this.logger.log({ event: 'job.charge_after', ...counts, ms: Date.now() - started });
      return counts;
    } catch (error) {
      this.logger.error({ event: 'job.charge_after_failed' }, stackOf(error));
      return {};
    }
  }

  /** One booking through `settlementPlan`, claimed before any money moves. */
  private async settleOne(bookingId: string, now: Date): Promise<string> {
    const booking = await this.prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: {
        ...REQUEST_SELECT,
        currency: true,
        cesuReminderSentAt: true,
        autoChargedAt: true,
      },
    });
    if (!booking.paymentMethod || !booking.acceptedAt || booking.autoChargedAt) {
      return 'skipped';
    }
    const [coverage, waiting, link] = await Promise.all([
      bookingCoverage(this.prisma, booking),
      this.prisma.payment.count({
        where: {
          bookingId,
          purpose: 'service',
          status: 'pending',
          method: { in: ['cesu', 'avance_immediate'] },
        },
      }),
      this.prisma.urssafLink.findUnique({
        where: {
          clientId_chefProfileId: {
            clientId: booking.clientId,
            chefProfileId: booking.chefProfileId,
          },
        },
        select: { status: true },
      }),
    ]);
    const step = settlementPlan(
      {
        method: booking.paymentMethod,
        acceptedAt: booking.acceptedAt,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        remainingCents: coverage.remainingAmountCents,
        waiting: waiting > 0,
        urssafLinkActive: link?.status === 'active',
      },
      now,
    );
    if (step === 'none') return step;

    if (step === 'remind_cesu') {
      const claimed = await this.prisma.booking.updateMany({
        where: { id: bookingId, cesuReminderSentAt: null },
        data: { cesuReminderSentAt: now },
      });
      if (claimed.count !== 1) return 'none';
      await this.notify(booking.clientId, 'booking.cesu_due', bookingId);
      await this.mailer.cesuReminder({
        bookingId,
        reference: booking.reference,
        startsAt: booking.startsAt,
        amountCents: coverage.remainingAmountCents,
        client: booking.client,
        chefName: booking.chefProfile.displayName,
      });
      return step;
    }

    const claimed = await this.prisma.booking.updateMany({
      where: { id: bookingId, autoChargedAt: null },
      data: { autoChargedAt: now },
    });
    if (claimed.count !== 1) return 'none';

    if (step === 'urssaf') {
      try {
        await this.bookingPayments.settleWithUrssafFor(bookingId);
        this.logger.log({ event: 'booking.urssaf_sent_after', bookingId });
        return step;
      } catch (error) {
        // URSSAF unreachable or the booking refused there: the saved card pays.
        this.logger.error(
          { event: 'booking.urssaf_after_failed', bookingId },
          stackOf(error),
        );
      }
    }
    const outcome = await this.payments.chargeSavedCard(bookingId);
    if (outcome.ok) return 'card';
    await this.notify(booking.clientId, 'booking.charge_failed', bookingId);
    await this.mailer.chargeFailed({
      bookingId,
      reference: booking.reference,
      startsAt: booking.startsAt,
      amountCents: coverage.remainingAmountCents,
      client: booking.client,
      chefName: booking.chefProfile.displayName,
    });
    return 'card_failed';
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private client(): Stripe {
    if (!this.stripe.configured) {
      throw new ServiceUnavailableException({
        code: 'PAYMENTS_UNAVAILABLE',
        message: 'Stripe is not configured (STRIPE_SECRET_KEY missing).',
      });
    }
    return this.stripe.getClient();
  }

  /** The client's Stripe customer: one an earlier booking or grocery run made, else new. */
  private async customerFor(booking: {
    id: string;
    clientId: string;
    client: { email: string; fullName: string | null };
  }): Promise<string> {
    const [earlier, run] = await Promise.all([
      this.prisma.booking.findFirst({
        where: { clientId: booking.clientId, stripeCustomerId: { not: null } },
        select: { stripeCustomerId: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.groceryRun.findFirst({
        where: {
          booking: { clientId: booking.clientId },
          stripeCustomerId: { not: null },
        },
        select: { stripeCustomerId: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const known = earlier?.stripeCustomerId ?? run?.stripeCustomerId;
    if (known) return known;
    const customer = await this.client().customers.create(
      {
        email: booking.client.email,
        name: booking.client.fullName ?? undefined,
        metadata: { userId: booking.clientId },
      },
      // The same key as the grocery flow: one customer per client, whichever comes first.
      { idempotencyKey: `grocery-customer-${booking.clientId}` },
    );
    return customer.id;
  }

  private async ownRequest(clerkUserId: string, bookingId: string) {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, clientId: user.id },
      select: REQUEST_SELECT,
    });
    if (!booking) throw notFound();
    if (!booking.paymentMethod) throw notARequest();
    return booking;
  }

  private async chefRequest(chefProfileId: string, bookingId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, chefProfileId },
      select: REQUEST_SELECT,
    });
    if (!booking) throw notFound();
    if (!booking.paymentMethod || !booking.requestedAt || booking.status !== 'pending') {
      throw notARequest();
    }
    return booking;
  }

  private async tellChef(
    booking: {
      id: string;
      reference: string | null;
      startsAt: Date;
      amountTtc: number | null;
      priceCents: number;
      paymentMethod: PaymentMethod | null;
      client: { fullName: string | null };
      chefProfile: { userId: string; user: { email: string; fullName: string | null } };
    },
    deadline: Date,
  ) {
    await this.notify(booking.chefProfile.userId, 'booking.requested', booking.id);
    await this.mailer.requestChef({
      bookingId: booking.id,
      reference: booking.reference,
      startsAt: booking.startsAt,
      acceptBy: deadline,
      amountTtcCents: booking.amountTtc ?? booking.priceCents,
      clientName: booking.client.fullName,
      chef: booking.chefProfile.user,
    });
  }

  /** In-app, best-effort: the move it reports stands either way. */
  private async notify(userId: string, type: string, bookingId: string) {
    await this.notifications
      .notify(userId, type, { type: 'booking', id: bookingId })
      .catch((error: unknown) =>
        this.logger.error(
          { event: 'booking.notify_failed', type, bookingId },
          stackOf(error),
        ),
      );
  }
}
