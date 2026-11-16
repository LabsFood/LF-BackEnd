import { createHash } from 'node:crypto';

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Stripe from 'stripe';

import { AuditService } from '../../common/audit/audit.service';
import { stackOf } from '../../common/logging/app-logger';
import { GroceryRun, Prisma, UserRole } from '../../generated/prisma/client';
import { BrevoService } from '../../integrations/brevo.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BookingDocumentsService } from '../bookings/booking-documents.service';
import { assertOwnSiteUrl } from '../payments/own-site-url';
import { KycStorageService } from '../chef-onboarding/services/kyc-storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { groceriesInForce } from '../platform-settings/groceries';
import { shoppingDeadline } from '../shopping-lists/domain/shopping-list.rules';
import { UsersService } from '../users/users.service';
import {
  groceriesBookingClosed,
  groceriesNotApplicable,
  groceryCardMissing,
  groceryLineNotFound,
  groceryNoticeSent,
  groceryReceiptsSent,
} from './domain/groceries.errors';
import {
  cancelIsLate,
  cancelRefusal,
  captureAmount,
  contestRefusal,
  deadlineOutcome,
  depositDeadlines,
  CLOSED_BOOKING_STATUSES,
  groceriesApply,
  groceriesShown,
  holdExpiry,
  instantPayoutFee,
  LineInput,
  lockAt,
  MANDATE_VERSION,
  mandateRules,
  MandateRules,
  noticeRefusal,
  readMandateRules,
  receiptsRefusal,
  refundDue,
  RunStatus,
  safetyCaptureDue,
  settles,
} from './domain/groceries.rules';
import { GroceriesStripe } from './groceries-stripe';

type Role = 'client' | 'chef' | 'admin';

const BOOKING_SELECT = {
  id: true,
  reference: true,
  status: true,
  startsAt: true,
  clientId: true,
  shoppingByClient: true,
  shoppingFeeCents: true,
  amountTtc: true,
  priceCents: true,
  deboursMandateAcceptedAt: true,
  serviceOffer: { select: { shoppingIncluded: true } },
  client: { select: { id: true, email: true, fullName: true } },
  chefProfile: {
    select: {
      id: true,
      userId: true,
      displayName: true,
      stripeAccountId: true,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
    },
  },
} satisfies Prisma.BookingSelect;

type BookingRow = Prisma.BookingGetPayload<{ select: typeof BOOKING_SELECT }>;

const RUN_INCLUDE = {
  receipts: { orderBy: { purchasedAt: 'asc' } },
  lines: { orderBy: { createdAt: 'asc' } },
  disputes: { orderBy: { openedAt: 'desc' } },
} satisfies Prisma.GroceryRunInclude;

type RunRow = Prisma.GroceryRunGetPayload<{ include: typeof RUN_INCLUDE }>;

/** The statuses whose hold is still live on the card. */
const LIVE_HOLD: RunStatus[] = [
  'hold_placed',
  'notice_sent',
  'awaiting_client',
  'confirmed',
  'receipts_submitted',
];

const receiptPrefix = (bookingId: string) => `grocery-receipts/${bookingId}`;
const RECEIPT = 'receipt';

/** A claim older than this was lost with its process: it may be taken again. */
const CLAIM_STALE_MS = 10 * 60 * 1000;

const euros = (cents: number) =>
  `${(cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

const parisDayTime = (date: Date) =>
  date.toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * Recettes lot 6: the groceries paid apart (decisions of 31/10, 11/11 and 16/11).
 *
 * The flow, one row per prestation (`GroceryRun`):
 * 1. The mandate is accepted by the booking box; the client saves a card (SetupIntent).
 * 2. At the lock (T-48h), the Budget Courses is held on the card (`hold_placed`).
 * 3. The chef sends the message before the groceries with a cancel deadline; the
 *    client confirms (or, the console allowing it, the delivered e-mail's silence).
 * 4. The chef deposits the receipts within 24 h; 24 h later the exact total is
 *    captured and the rest released; lines are contested within 48 h and an admin
 *    arbitrates. A chargeback is borne by Lab's Food, then recovered from whoever was
 *    at fault.
 *
 * Every timed step is claimed by an `UPDATE` (as the lot 4 reminders): it runs once,
 * on any replica, and survives a restart.
 */
@Injectable()
export class GroceriesService {
  private readonly logger = new Logger(GroceriesService.name);
  private readonly siteUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly stripe: GroceriesStripe,
    private readonly notifications: NotificationsService,
    private readonly documents: BookingDocumentsService,
    private readonly receipts: KycStorageService,
    private readonly brevo: BrevoService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {
    this.siteUrl = config
      .get<string>('chefOnboarding.publicSiteUrl', 'https://labsfood.fr')
      .replace(/\/$/, '');
  }

  // ------------------------------------------------------------------ access

  private async access(clerkUserId: string, bookingId: string) {
    const user = await this.users.findByClerkId(clerkUserId);
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: BOOKING_SELECT,
    });
    if (!user || !booking) throw new NotFoundException('No such prestation.');
    const role: Role | null =
      booking.chefProfile.userId === user.id
        ? 'chef'
        : booking.clientId === user.id
          ? 'client'
          : user.role === UserRole.admin
            ? 'admin'
            : null;
    if (!role) throw new NotFoundException('No such prestation.');
    return { user, booking, role };
  }

  private async as(role: Role, clerkUserId: string, bookingId: string) {
    const context = await this.access(clerkUserId, bookingId);
    if (context.role !== role && !(role === 'admin' && context.role === 'admin')) {
      throw new ForbiddenException({
        code: 'CONTENT_NOT_OWNED',
        message:
          role === 'client'
            ? 'Only the client of this prestation can do this.'
            : role === 'chef'
              ? 'Only the batch cooker of this prestation can do this.'
              : 'Only Lab’s Food can do this.',
      });
    }
    return context;
  }

  private async run(bookingId: string): Promise<RunRow | null> {
    return this.prisma.groceryRun.findUnique({
      where: { bookingId },
      include: RUN_INCLUDE,
    });
  }

  private async runOrThrow(bookingId: string): Promise<RunRow> {
    const run = await this.run(bookingId);
    if (!run) throw groceryCardMissing();
    return run;
  }

  private rulesOf(run: Pick<GroceryRun, 'mandateRules' | 'budgetCents'>): MandateRules {
    return readMandateRules(run.mandateRules, run.budgetCents);
  }

  // -------------------------------------------------------------------- view

  /** `GET …/groceries`: where the groceries stand, worded by the fronts. */
  async view(clerkUserId: string, bookingId: string) {
    const { booking, role } = await this.access(clerkUserId, bookingId);
    return this.toView(booking, await this.run(bookingId), role);
  }

  private async toView(booking: BookingRow, run: RunRow | null, role: Role) {
    const settings = await groceriesInForce(this.prisma);
    const applies = groceriesShown(booking, run !== null);
    const budgetCents = run?.budgetCents ?? settings.budgetMaxCents;
    const rules = run ? this.rulesOf(run) : mandateRules(budgetCents);
    const opensAt = lockAt(booking.startsAt, rules);
    const lines = run?.lines ?? [];
    return {
      bookingId: booking.id,
      applies,
      status: (run?.status ?? (applies ? 'awaiting_card' : null)) as RunStatus | null,
      budgetCents,
      /** « Budget garanti » for the chef once the hold is placed. */
      guaranteed: !!run?.holdPlacedAt && LIVE_HOLD.includes(run.status as RunStatus),
      opensAt,
      mandate: run
        ? {
            version: run.mandateVersion,
            acceptedAt: run.mandateAcceptedAt,
            maxCents: run.budgetCents,
            ...(role !== 'chef' && { documentSha256: run.mandateDocumentSha256 }),
            ...(role === 'admin' && {
              ip: run.mandateIp,
              userAgent: run.mandateUserAgent,
            }),
          }
        : null,
      card:
        run?.cardLast4 && role !== 'chef'
          ? {
              brand: run.cardBrand,
              last4: run.cardLast4,
              expMonth: run.cardExpMonth,
              expYear: run.cardExpYear,
            }
          : null,
      hold: run
        ? {
            placedAt: run.holdPlacedAt,
            expiresAt: run.holdExpiresAt,
            failedAt: run.holdFailedAt,
            failureCode: role === 'chef' ? null : run.holdFailureCode,
            /** Until this, a refused card can be changed; then the client shops. */
            fixBefore: shoppingDeadline(booking.startsAt),
          }
        : null,
      notice: run?.noticeSentAt
        ? {
            sentAt: run.noticeSentAt,
            shoppingAt: run.shoppingAt,
            cancelDeadline: run.cancelDeadline,
            email:
              role === 'client'
                ? undefined
                : {
                    deliveredAt: run.emailDeliveredAt,
                    bouncedAt: run.emailBouncedAt,
                    lastEvent: run.emailLastEvent,
                  },
            confirmedAt: run.confirmedAt,
            confirmedBy: run.confirmedBy,
          }
        : null,
      minNoticeMinutes: settings.minCancelNoticeMinutes,
      silenceConfirms: settings.silenceConfirms,
      cancelled: run?.cancelledAt
        ? { at: run.cancelledAt, by: run.cancelledBy, reason: run.cancelReason }
        : null,
      forfaitWaivedCents: run?.forfaitWaivedCents ?? 0,
      receipts: (run?.receipts ?? []).map((receipt) => ({
        id: receipt.id,
        purchasedAt: receipt.purchasedAt,
        mimeType: receipt.mimeType,
      })),
      lines: lines.map((line) => ({
        id: line.id,
        label: line.label,
        amountCents: line.amountCents,
        receiptId: line.receiptId,
        clientApprovedAt: line.clientApprovedAt,
        contestedAt: line.contestedAt,
        contestReason: line.contestReason,
        decision: line.decision,
        decidedAt: line.decidedAt,
        decisionNote: line.decisionNote,
        refundedCents: line.refundedCents,
      })),
      receiptsSubmittedAt: run?.receiptsSubmittedAt ?? null,
      receiptsTotalCents: run?.receiptsTotalCents ?? null,
      contestClosesAt: run?.contestClosesAt ?? null,
      captureDueAt: run?.captureDueAt ?? null,
      capture: run?.capturedAt
        ? {
            at: run.capturedAt,
            cents: run.capturedCents,
            releasedCents: run.releasedCents,
            safety: run.safetyCapture,
          }
        : null,
      refundedCents: lines.reduce((sum, line) => sum + line.refundedCents, 0),
      instantPayout:
        role === 'client'
          ? undefined
          : run
            ? {
                chosen: run.instantPayout,
                feeCents: run.instantPayoutFeeCents,
                status: run.instantPayoutStatus,
              }
            : null,
      instantPayoutFee:
        role === 'client'
          ? undefined
          : {
              bps: settings.instantPayoutFeeBps,
              minCents: settings.instantPayoutFeeMinCents,
            },
      disputes:
        role === 'admin'
          ? (run?.disputes ?? []).map((dispute) => ({
              id: dispute.id,
              amountCents: dispute.amountCents,
              reason: dispute.reason,
              status: dispute.status,
              openedAt: dispute.openedAt,
              closedAt: dispute.closedAt,
              fault: dispute.fault,
              recoveryStatus: dispute.recoveryStatus,
              recoveryReference: dispute.recoveryReference,
              recoveredAt: dispute.recoveredAt,
            }))
          : undefined,
      settledAt: run?.settledAt ?? null,
    };
  }

  // ------------------------------------------------------------ client: card

  /**
   * `POST /me/bookings/{id}/groceries/card`: a Stripe Checkout page in setup mode. The
   * first call records the proof of the mandate (decision of 16/11: the booking box is
   * the signature): version and clauses, maximum, the PDF's SHA-256, IP and browser.
   */
  async startCard(
    clerkUserId: string,
    bookingId: string,
    meta: { ip?: string | null; userAgent?: string | null },
    urls: { successUrl: string; cancelUrl: string },
  ) {
    for (const url of [urls.successUrl, urls.cancelUrl]) {
      assertOwnSiteUrl(
        this.config,
        url,
        'successUrl and cancelUrl must point at a Lab’s Food site.',
      );
    }
    const { booking } = await this.as('client', clerkUserId, bookingId);
    if (!groceriesApply(booking)) throw groceriesNotApplicable();
    if (CLOSED_BOOKING_STATUSES.includes(booking.status)) {
      throw groceriesBookingClosed(booking.status);
    }
    let run = await this.ensureRun(booking, meta);
    if (run.status === 'cancelled' || run.receiptsSubmittedAt) {
      throw new ConflictException({
        code: 'GROCERY_CARD_LOCKED',
        message: 'The card of these groceries can no longer be changed.',
      });
    }
    const customerId = run.stripeCustomerId ?? (await this.customerFor(booking));
    if (!run.stripeCustomerId) {
      run = await this.prisma.groceryRun.update({
        where: { id: run.id },
        data: { stripeCustomerId: customerId },
        include: RUN_INCLUDE,
      });
    }
    const session = await this.stripe.createSetupSession({
      customerId,
      runId: run.id,
      successUrl: urls.successUrl,
      cancelUrl: urls.cancelUrl,
    });
    // The page's id until it completes; its SetupIntent's id once the card is saved.
    await this.prisma.groceryRun.update({
      where: { id: run.id },
      data: { stripeSetupIntentId: session.id },
    });
    await this.audit.record({
      actorType: 'client',
      actorUserId: booking.clientId,
      action: 'groceries.card_started',
      subjectType: 'grocery_run',
      subjectId: run.id,
    });
    return { sessionId: session.id, url: session.url ?? '' };
  }

  /** The client's Stripe customer: the one a previous run made, else a new one. */
  private async customerFor(booking: BookingRow): Promise<string> {
    const previous = await this.prisma.groceryRun.findFirst({
      where: { booking: { clientId: booking.clientId }, stripeCustomerId: { not: null } },
      select: { stripeCustomerId: true },
      orderBy: { createdAt: 'desc' },
    });
    if (previous?.stripeCustomerId) return previous.stripeCustomerId;
    return this.stripe.createCustomer({
      email: booking.client.email,
      name: booking.client.fullName,
      userId: booking.clientId,
    });
  }

  /** The run of a booking with groceries, created with its mandate proof. */
  private async ensureRun(
    booking: BookingRow,
    meta: { ip?: string | null; userAgent?: string | null } = {},
  ): Promise<RunRow> {
    const existing = await this.run(booking.id);
    if (existing) return existing;
    const settings = await groceriesInForce(this.prisma);
    const rules = mandateRules(settings.budgetMaxCents);
    try {
      await this.prisma.groceryRun.create({
        data: {
          bookingId: booking.id,
          budgetCents: rules.budgetCents,
          mandateVersion: MANDATE_VERSION,
          mandateRules: rules as unknown as Prisma.InputJsonValue,
          mandateAcceptedAt: booking.deboursMandateAcceptedAt!,
          mandateIp: meta.ip?.slice(0, 64) ?? null,
          mandateUserAgent: meta.userAgent?.slice(0, 512) ?? null,
        },
      });
    } catch (error) {
      // Two first calls at once: the unique booking id keeps one run.
      if ((error as { code?: string }).code !== 'P2002') throw error;
    }
    // The PDF as it reads with its Budget, hashed for the proof.
    try {
      const pdf = await this.documents.mandatePdf(booking.id);
      if (pdf) {
        await this.prisma.groceryRun.updateMany({
          where: { bookingId: booking.id, mandateDocumentSha256: null },
          data: { mandateDocumentSha256: createHash('sha256').update(pdf).digest('hex') },
        });
      }
    } catch (error) {
      this.logger.error(
        { event: 'groceries.mandate_hash_failed', bookingId: booking.id },
        stackOf(error),
      );
    }
    await this.audit.record({
      actorType: 'client',
      actorUserId: booking.clientId,
      action: 'groceries.mandate_recorded',
      subjectType: 'booking',
      subjectId: booking.id,
      metadata: { version: MANDATE_VERSION, maxCents: rules.budgetCents },
    });
    return (await this.run(booking.id))!;
  }

  /**
   * `POST /me/bookings/{id}/groceries/card/confirm`: back from the setup page, the card
   * is saved (ids and display only). Inside the lock, the hold is placed at once, the
   * client present; after a refused hold, it is tried again.
   */
  async confirmCard(clerkUserId: string, bookingId: string, sessionId: string) {
    const { booking, role } = await this.as('client', clerkUserId, bookingId);
    const run = await this.runOrThrow(bookingId);
    if (run.stripeSetupIntentId !== sessionId) {
      // Already saved by the webhook: the same answer, nothing to redo.
      if (!run.stripePaymentMethodId) {
        throw new ConflictException({
          code: 'GROCERY_SETUP_MISMATCH',
          message: 'This card setup is not the one of these groceries.',
        });
      }
    } else {
      const intent = await this.stripe.setupIntentOfSession(sessionId);
      if (!intent) throw groceryCardMissing();
      await this.saveCard(run, intent);
    }
    const saved = (await this.run(bookingId))!;
    if (new Date() >= lockAt(booking.startsAt, this.rulesOf(saved))) {
      await this.placeHold(saved.id, new Date());
    }
    return this.toView(booking, await this.run(bookingId), role);
  }

  /** Webhook `setup_intent.succeeded` for a grocery card: the same save, idempotent. */
  async handleSetupIntentSucceeded(intent: Stripe.SetupIntent): Promise<boolean> {
    // The run id rides on the SetupIntent we asked the setup page to create.
    const runId = intent.metadata?.groceryRunId;
    const run = await this.prisma.groceryRun.findFirst({
      where: runId
        ? { OR: [{ id: runId }, { stripeSetupIntentId: intent.id }] }
        : { stripeSetupIntentId: intent.id },
      include: RUN_INCLUDE,
    });
    if (!run) return false;
    const full =
      typeof intent.payment_method === 'string'
        ? await this.stripe.retrieveSetupIntent(intent.id)
        : intent;
    await this.saveCard(run, full);
    return true;
  }

  private async saveCard(run: RunRow, intent: Stripe.SetupIntent) {
    if (intent.status !== 'succeeded') {
      throw new ConflictException({
        code: 'GROCERY_CARD_NOT_SAVED',
        message: 'The card is not saved yet: finish the step on the card form.',
        stripeStatus: intent.status,
      });
    }
    const method = intent.payment_method as Stripe.PaymentMethod | null;
    if (!method || typeof method === 'string') throw groceryCardMissing();
    if (run.stripePaymentMethodId === method.id) return;
    await this.prisma.groceryRun.update({
      where: { id: run.id },
      data: {
        stripePaymentMethodId: method.id,
        cardBrand: method.card?.brand ?? null,
        cardLast4: method.card?.last4 ?? null,
        cardExpMonth: method.card?.exp_month ?? null,
        cardExpYear: method.card?.exp_year ?? null,
        cardSavedAt: new Date(),
        stripeSetupIntentId: intent.id,
        ...(run.status === 'awaiting_card' ? { status: 'card_saved' } : {}),
      },
    });
    this.logger.log({ event: 'groceries.card_saved', groceryRunId: run.id });
  }

  // --------------------------------------------------------------- the hold

  /**
   * Places the hold of one run, once: claimed by an UPDATE, a payment row written
   * before the Stripe call (its id seeds the idempotency key).
   */
  async placeHold(runId: string, now: Date): Promise<'placed' | 'failed' | 'skipped'> {
    const claimed = await this.prisma.groceryRun.updateMany({
      where: {
        id: runId,
        status: { in: ['card_saved', 'hold_failed'] },
        stripePaymentMethodId: { not: null },
        OR: [
          { holdClaimedAt: null },
          { holdClaimedAt: { lt: new Date(now.getTime() - CLAIM_STALE_MS) } },
        ],
      },
      data: { holdClaimedAt: now },
    });
    if (claimed.count !== 1) return 'skipped';
    const run = await this.prisma.groceryRun.findUniqueOrThrow({
      where: { id: runId },
      include: { booking: { select: BOOKING_SELECT } },
    });
    const { booking } = run;
    const chef = booking.chefProfile;
    const payment = await this.prisma.payment.create({
      data: {
        bookingId: booking.id,
        method: 'cb',
        purpose: 'courses',
        status: 'pending',
        amountTtc: run.budgetCents,
        currency: 'EUR',
        metadata: { groceryRunId: run.id, kind: 'hold' },
      },
    });
    const result =
      chef.stripeAccountId && chef.stripeChargesEnabled
        ? await this.stripe.placeHold({
            runId: run.id,
            paymentId: payment.id,
            amountCents: run.budgetCents,
            customerId: run.stripeCustomerId!,
            paymentMethodId: run.stripePaymentMethodId!,
            chefAccountId: chef.stripeAccountId,
            bookingId: booking.id,
            bookingReference: booking.reference,
          })
        : ({
            ok: false,
            code: 'chef_account_not_ready',
            paymentIntentId: null,
            needsAuthentication: false,
          } as const);

    if (result.ok) {
      await this.prisma.$transaction([
        this.prisma.payment.update({
          where: { id: payment.id },
          data: { stripePaymentIntentId: result.intent.id },
        }),
        this.prisma.groceryRun.update({
          where: { id: run.id },
          data: {
            status: 'hold_placed',
            holdPaymentId: payment.id,
            holdPlacedAt: now,
            holdExpiresAt: holdExpiry(now, result.captureBefore),
            holdFailedAt: null,
            holdFailureCode: null,
            holdClaimedAt: null,
          },
        }),
      ]);
      await this.tell(booking.clientId, 'groceries.hold_placed', booking.id);
      await this.tell(chef.userId, 'groceries.budget_guaranteed', booking.id);
      this.logger.log({
        event: 'groceries.hold_placed',
        groceryRunId: run.id,
        bookingId: booking.id,
      });
      return 'placed';
    }
    await this.prisma.$transaction([
      this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'failed',
          failureReason: result.code,
          ...(result.paymentIntentId
            ? { stripePaymentIntentId: result.paymentIntentId }
            : {}),
        },
      }),
      this.prisma.groceryRun.update({
        where: { id: run.id },
        data: {
          status: 'hold_failed',
          holdFailedAt: now,
          holdFailureCode: result.needsAuthentication
            ? 'authentication_required'
            : result.code,
          holdClaimedAt: null,
        },
      }),
    ]);
    await this.tell(booking.clientId, 'groceries.hold_failed', booking.id);
    this.logger.warn({
      event: 'groceries.hold_failed',
      groceryRunId: run.id,
      code: result.code,
    });
    return 'failed';
  }

  /**
   * `POST /me/bookings/{id}/groceries/hold/retry`: after the client authenticated the
   * refused hold (3-D Secure) or changed their card, try again now.
   */
  async retryHold(clerkUserId: string, bookingId: string) {
    const { booking, role } = await this.as('client', clerkUserId, bookingId);
    const run = await this.runOrThrow(bookingId);
    if (run.status === 'hold_failed') await this.placeHold(run.id, new Date());
    return this.toView(booking, await this.run(bookingId), role);
  }

  // ------------------------------------------------- the message, art. 8

  /** `POST /chef-missions/{id}/groceries/notice`: the message before the groceries. */
  async sendNotice(
    clerkUserId: string,
    bookingId: string,
    input: { shoppingAt: Date; cancelDeadline: Date },
  ) {
    const { booking, role } = await this.as('chef', clerkUserId, bookingId);
    const run = await this.runOrThrow(bookingId);
    const settings = await groceriesInForce(this.prisma);
    const now = new Date();
    const refusal = noticeRefusal({
      status: run.status as RunStatus,
      now,
      startsAt: booking.startsAt,
      rules: this.rulesOf(run),
      shoppingAt: input.shoppingAt,
      cancelDeadline: input.cancelDeadline,
      minNoticeMinutes: settings.minCancelNoticeMinutes,
    });
    if (refusal) throw refusal;
    const claimed = await this.prisma.groceryRun.updateMany({
      where: { id: run.id, status: 'hold_placed' },
      data: {
        status: 'notice_sent',
        noticeSentAt: now,
        shoppingAt: input.shoppingAt,
        cancelDeadline: input.cancelDeadline,
      },
    });
    if (claimed.count !== 1) throw groceryNoticeSent();

    // Two channels: the bell, and the e-mail whose delivery Brevo confirms by webhook.
    const notification = await this.tell(
      booking.clientId,
      'groceries.notice',
      booking.id,
    );
    const sent = await this.brevo.sendTemplate({
      templateId: this.brevo.templates.groceriesNotice,
      to: { email: booking.client.email, name: booking.client.fullName ?? undefined },
      label: 'groceries-notice',
      params: {
        firstName: booking.client.fullName?.split(' ')[0] ?? '',
        chefName: booking.chefProfile.displayName,
        shoppingDay: parisDayTime(input.shoppingAt),
        deadline: parisDayTime(input.cancelDeadline),
        budget: euros(run.budgetCents),
        bookingUrl: `${this.siteUrl}/espace-client/commandes/${booking.id}`,
      },
    });
    await this.prisma.groceryRun.update({
      where: { id: run.id },
      data: {
        noticeNotificationId: notification?.id ?? null,
        emailMessageId: sent.messageId ?? null,
        emailLastEvent: sent.sent ? 'sent' : 'not_sent',
      },
    });
    await this.audit.record({
      actorType: 'chef',
      actorUserId: booking.chefProfile.userId,
      action: 'groceries.notice_sent',
      subjectType: 'grocery_run',
      subjectId: run.id,
      metadata: {
        shoppingAt: input.shoppingAt.toISOString(),
        cancelDeadline: input.cancelDeadline.toISOString(),
        emailSent: sent.sent,
        messageId: sent.messageId ?? null,
        notificationId: notification?.id ?? null,
      },
    });
    return this.toView(booking, await this.run(bookingId), role);
  }

  /** `POST /me/bookings/{id}/groceries/confirm`: the client's click. */
  async confirm(clerkUserId: string, bookingId: string) {
    const { booking, role } = await this.as('client', clerkUserId, bookingId);
    const run = await this.runOrThrow(bookingId);
    const confirmed = await this.prisma.groceryRun.updateMany({
      where: { id: run.id, status: { in: ['notice_sent', 'awaiting_client'] } },
      data: { status: 'confirmed', confirmedAt: new Date(), confirmedBy: 'client' },
    });
    if (confirmed.count !== 1) {
      throw new ConflictException({
        code: 'GROCERY_NOTHING_TO_CONFIRM',
        message: 'There is no message before the groceries to confirm.',
      });
    }
    await this.tell(booking.chefProfile.userId, 'groceries.confirmed', booking.id);
    await this.audit.record({
      actorType: 'client',
      actorUserId: booking.clientId,
      action: 'groceries.confirmed',
      subjectType: 'grocery_run',
      subjectId: run.id,
    });
    return this.toView(booking, await this.run(bookingId), role);
  }

  /**
   * `POST /me/bookings/{id}/groceries/cancel`: until the groceries are done. Before
   * the lock the mandate is revoked for free; after it the prestation is kept and the
   * client buys the final list themselves: nothing to refund (art. 8). Either way the
   * hold is released and the list becomes the client's.
   */
  async cancel(clerkUserId: string, bookingId: string, reason?: string) {
    const { booking, role } = await this.as('client', clerkUserId, bookingId);
    const run = await this.runOrThrow(bookingId);
    const refusal = cancelRefusal(run.status as RunStatus);
    if (refusal) throw refusal;
    await this.cancelRun(run, booking, 'client', reason?.trim() || null, new Date());
    return this.toView(booking, await this.run(bookingId), role);
  }

  private async cancelRun(
    run: GroceryRun,
    booking: BookingRow,
    by: 'client' | 'system' | 'admin',
    reason: string | null,
    now: Date,
  ) {
    const late = cancelIsLate(now, booking.startsAt, this.rulesOf(run));
    const claimed = await this.prisma.groceryRun.updateMany({
      where: {
        id: run.id,
        status: { notIn: ['cancelled', 'receipts_submitted', 'captured', 'settled'] },
      },
      data: {
        status: 'cancelled',
        cancelledAt: now,
        cancelledBy: by,
        cancelReason: reason,
      },
    });
    if (claimed.count !== 1) return;
    await this.releaseHold(run);
    const waived = await this.waiveForfaitIfUnpaid(booking);
    await this.prisma.$transaction([
      this.prisma.booking.update({
        where: { id: booking.id },
        // The list is the client's from now on: the chef's shopping reminders stop.
        data: { shoppingByClient: true },
      }),
      this.prisma.groceryRun.update({
        where: { id: run.id },
        data: { forfaitWaivedCents: waived },
      }),
    ]);
    await this.tell(booking.chefProfile.userId, 'groceries.cancelled', booking.id);
    if (by !== 'client')
      await this.tell(booking.clientId, 'groceries.cancelled', booking.id);
    await this.audit.record({
      actorType: by === 'system' ? 'system' : by,
      actorUserId: by === 'client' ? booking.clientId : null,
      action: 'groceries.cancelled',
      subjectType: 'grocery_run',
      subjectId: run.id,
      metadata: { late, by, forfaitWaivedCents: waived },
    });
  }

  /**
   * The groceries will not be done: the forfait courses leaves a prestation not yet
   * paid (it is never on the URSSAF request then). Already paid, it stays: nothing is
   * refunded (art. 8).
   */
  private async waiveForfaitIfUnpaid(booking: BookingRow): Promise<number> {
    if (booking.shoppingFeeCents <= 0) return 0;
    const paid = await this.prisma.payment.count({
      where: {
        bookingId: booking.id,
        purpose: 'service',
        OR: [
          { status: 'succeeded' },
          { status: 'pending', method: { in: ['cesu', 'avance_immediate'] } },
        ],
      },
    });
    if (paid > 0) return 0;
    const fee = booking.shoppingFeeCents;
    await this.prisma.booking.update({
      where: { id: booking.id },
      data: {
        shoppingFeeCents: 0,
        ...(booking.amountTtc !== null
          ? { amountTtc: Math.max(0, booking.amountTtc - fee) }
          : {}),
        priceCents: Math.max(0, booking.priceCents - fee),
      },
    });
    return fee;
  }

  private async releaseHold(run: GroceryRun) {
    if (!run.holdPaymentId) return;
    const payment = await this.prisma.payment.findUnique({
      where: { id: run.holdPaymentId },
    });
    if (!payment?.stripePaymentIntentId || payment.status !== 'pending') return;
    try {
      await this.stripe.cancelHold(payment.stripePaymentIntentId, run.id);
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'failed', failureReason: 'Hold released: groceries cancelled.' },
      });
    } catch (error) {
      this.logger.error(
        { event: 'groceries.release_failed', groceryRunId: run.id },
        stackOf(error),
      );
    }
  }

  // --------------------------------------------------------------- receipts

  /** `POST /chef-missions/{id}/groceries/receipts/upload-url`: a receipt photo. */
  async receiptUploadUrl(
    clerkUserId: string,
    bookingId: string,
    input: { contentType: string; sizeBytes: number },
  ) {
    const { booking } = await this.as('chef', clerkUserId, bookingId);
    await this.runOrThrow(booking.id);
    const upload = await this.receipts.createUploadUrl(
      receiptPrefix(booking.id),
      RECEIPT,
      input.contentType,
      input.sizeBytes,
    );
    // Never the storage path: the deposit names the photo by its upload id.
    return {
      uploadId: upload.uploadId,
      method: upload.method,
      url: upload.url,
      headers: upload.headers,
      expiresAt: upload.expiresAt,
    };
  }

  /**
   * `POST /chef-missions/{id}/groceries/receipts`: the one deposit, within 24 h of the
   * purchase. A total above the Budget is refused (the gap stays with the chef); a line
   * without a receipt is kept but not reimbursed unless the client agrees.
   */
  async submitReceipts(
    clerkUserId: string,
    bookingId: string,
    input: {
      receipts: { uploadId: string; purchasedAt: Date }[];
      lines: LineInput[];
      instantPayout?: boolean;
    },
  ) {
    const { booking, role } = await this.as('chef', clerkUserId, bookingId);
    const run = await this.runOrThrow(bookingId);
    const now = new Date();
    const rules = this.rulesOf(run);
    // A safety capture took the whole Budget before any receipt: the deposit still opens.
    const status: RunStatus =
      run.status === 'captured' && run.safetyCapture && !run.receiptsSubmittedAt
        ? 'confirmed'
        : (run.status as RunStatus);
    const refusal = receiptsRefusal({
      status,
      now,
      startsAt: booking.startsAt,
      rules,
      receipts: input.receipts,
      lines: input.lines,
    });
    if (refusal) throw refusal;

    const stored: { path: string; mimeType: string; purchasedAt: Date }[] = [];
    for (const receipt of input.receipts) {
      const path = this.receipts.buildPath(
        receiptPrefix(booking.id),
        RECEIPT,
        receipt.uploadId,
      );
      const stat = await this.receipts.statObject(path).catch(() => null);
      if (!stat) {
        throw new ConflictException({
          code: 'GROCERY_RECEIPT_MISSING',
          message: 'A receipt photo was not uploaded. Upload it, then deposit.',
          uploadId: receipt.uploadId,
        });
      }
      this.receipts.assertAcceptable(stat.mimeType, stat.sizeBytes);
      stored.push({ path, mimeType: stat.mimeType, purchasedAt: receipt.purchasedAt });
    }
    const total = input.lines.reduce((sum, line) => sum + line.amountCents, 0);
    const deadlines = depositDeadlines(now, rules);
    const settings = await groceriesInForce(this.prisma);

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.groceryRun.updateMany({
        where: { id: run.id, receiptsSubmittedAt: null },
        data: {
          ...(run.status === 'captured' ? {} : { status: 'receipts_submitted' }),
          receiptsSubmittedAt: now,
          receiptsTotalCents: total,
          captureDueAt: deadlines.captureDueAt,
          contestClosesAt: deadlines.contestClosesAt,
          instantPayout: input.instantPayout === true,
          instantPayoutFeeCents:
            input.instantPayout === true ? instantPayoutFee(total, settings) : null,
        },
      });
      if (claimed.count !== 1) throw groceryReceiptsSent();
      const ids: string[] = [];
      for (const receipt of stored) {
        const row = await tx.groceryReceipt.create({
          data: {
            groceryRunId: run.id,
            storagePath: receipt.path,
            mimeType: receipt.mimeType,
            purchasedAt: receipt.purchasedAt,
          },
        });
        ids.push(row.id);
      }
      await tx.groceryLine.createMany({
        data: input.lines.map((line) => ({
          groceryRunId: run.id,
          receiptId: line.receipt === null ? null : ids[line.receipt],
          label: line.label.trim().slice(0, 160),
          amountCents: line.amountCents,
        })),
      });
      // Lot 4's « Courses faites » follows the deposit: the step and its total.
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          groceriesValidatedAt: now,
          groceriesAmountCents: total,
        },
      });
    });
    await this.tell(booking.clientId, 'groceries.receipts_submitted', booking.id);
    await this.audit.record({
      actorType: 'chef',
      actorUserId: booking.chefProfile.userId,
      action: 'groceries.receipts_submitted',
      subjectType: 'grocery_run',
      subjectId: run.id,
      metadata: { totalCents: total, receipts: stored.length, lines: input.lines.length },
    });
    // After a safety capture, the difference goes back to the client at once.
    if (run.status === 'captured' && run.safetyCapture)
      await this.refundSafetyDifference(run.id);
    return this.toView(booking, await this.run(bookingId), role);
  }

  /** A receipt photo for 5 minutes: to the client, the chef and the admins. */
  async receiptUrl(clerkUserId: string, bookingId: string, receiptId: string) {
    await this.access(clerkUserId, bookingId);
    const receipt = await this.prisma.groceryReceipt.findFirst({
      where: { id: receiptId, groceryRun: { bookingId } },
    });
    if (!receipt) throw new NotFoundException('No such receipt.');
    return this.receipts.createDownloadUrl(receipt.storagePath);
  }

  // ------------------------------------------------ client: lines, contests

  /** `POST /me/bookings/{id}/groceries/lines/{lineId}/approve`: a line without receipt. */
  async approveLine(clerkUserId: string, bookingId: string, lineId: string) {
    const { booking, role } = await this.as('client', clerkUserId, bookingId);
    const run = await this.runOrThrow(bookingId);
    const line = run.lines.find((l) => l.id === lineId);
    if (!line) throw groceryLineNotFound();
    if (run.capturedAt && !run.safetyCapture) {
      throw new ConflictException({
        code: 'GROCERY_ALREADY_CHARGED',
        message: 'The groceries are already charged: this line can no longer be added.',
      });
    }
    if (line.receiptId === null && !line.clientApprovedAt) {
      await this.prisma.groceryLine.update({
        where: { id: line.id },
        data: { clientApprovedAt: new Date() },
      });
    }
    return this.toView(booking, await this.run(bookingId), role);
  }

  /** `POST /me/bookings/{id}/groceries/lines/{lineId}/contest`: within 48 h. */
  async contestLine(
    clerkUserId: string,
    bookingId: string,
    lineId: string,
    reason: string,
  ) {
    const { booking, role } = await this.as('client', clerkUserId, bookingId);
    const run = await this.runOrThrow(bookingId);
    const line = run.lines.find((l) => l.id === lineId);
    if (!line) throw groceryLineNotFound();
    const refusal = contestRefusal(line, run.contestClosesAt, new Date());
    if (refusal) throw refusal;
    await this.prisma.groceryLine.update({
      where: { id: line.id },
      data: { contestedAt: new Date(), contestReason: reason.trim().slice(0, 1000) },
    });
    await this.tell(booking.chefProfile.userId, 'groceries.line_contested', booking.id);
    await this.audit.record({
      actorType: 'client',
      actorUserId: booking.clientId,
      action: 'groceries.line_contested',
      subjectType: 'grocery_line',
      subjectId: line.id,
      metadata: { amountCents: line.amountCents },
    });
    return this.toView(booking, await this.run(bookingId), role);
  }

  /**
   * `POST /admin/bookings/{id}/groceries/lines/{lineId}/decision`. Upheld before the
   * capture, the line is left out of it; after, it is refunded to the client and taken
   * back from the chef's transfer.
   */
  async decideLine(
    clerkUserId: string,
    bookingId: string,
    lineId: string,
    input: { decision: 'upheld' | 'rejected'; note?: string },
  ) {
    const { user, booking, role } = await this.as('admin', clerkUserId, bookingId);
    const run = await this.runOrThrow(bookingId);
    const line = run.lines.find((l) => l.id === lineId);
    if (!line?.contestedAt) throw groceryLineNotFound();
    if (line.decision) {
      throw new ConflictException({
        code: 'GROCERY_LINE_DECIDED',
        message: 'This contest is already decided.',
      });
    }
    await this.prisma.groceryLine.update({
      where: { id: line.id },
      data: {
        decision: input.decision,
        decidedAt: new Date(),
        decidedByUserId: user.id,
        decisionNote: input.note?.trim() || null,
      },
    });
    if (input.decision === 'upheld' && run.capturedAt) {
      await this.refundLine(run, line.id, refundDue(line));
    }
    await this.tell(booking.clientId, 'groceries.contest_decided', booking.id);
    await this.tell(booking.chefProfile.userId, 'groceries.contest_decided', booking.id);
    await this.audit.record({
      actorType: 'admin',
      actorUserId: user.id,
      action: 'groceries.contest_decided',
      subjectType: 'grocery_line',
      subjectId: line.id,
      metadata: { decision: input.decision, amountCents: line.amountCents },
    });
    return this.toView(booking, await this.run(bookingId), role);
  }

  private async refundLine(run: GroceryRun, lineId: string, amountCents: number) {
    if (amountCents <= 0 || !run.holdPaymentId) return;
    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: run.holdPaymentId },
    });
    const refund = await this.stripe.refund({
      intentId: payment.stripePaymentIntentId!,
      amountCents,
      key: lineId,
    });
    await this.prisma.$transaction([
      this.prisma.groceryLine.update({
        where: { id: lineId },
        data: { refundedCents: { increment: amountCents }, stripeRefundId: refund.id },
      }),
      this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          refundedAmount: (payment.refundedAmount ?? 0) + amountCents,
          refundedAt: new Date(),
          status: 'partially_refunded',
        },
      }),
    ]);
  }

  // ---------------------------------------------------------- chef statement

  /** `GET /me/chef/groceries/statement?month=YYYY-MM`: the month's reimbursements. */
  async chefStatement(clerkUserId: string, month: string) {
    const chef = await this.users.chefIdentity(clerkUserId);
    const [year, mon] = month.split('-').map(Number);
    const start = new Date(Date.UTC(year, mon - 1, 1));
    const end = new Date(Date.UTC(year, mon, 1));
    const runs = await this.prisma.groceryRun.findMany({
      where: {
        booking: { chefProfileId: chef.chefProfileId },
        capturedAt: { gte: start, lt: end },
      },
      include: {
        booking: { select: { id: true, reference: true, startsAt: true } },
        lines: true,
      },
      orderBy: { capturedAt: 'asc' },
    });
    const rows = runs.map((run) => {
      const refunded = run.lines.reduce((sum, line) => sum + line.refundedCents, 0);
      const fee = run.instantPayout ? (run.instantPayoutFeeCents ?? 0) : 0;
      return {
        bookingId: run.booking.id,
        reference: run.booking.reference,
        startsAt: run.booking.startsAt,
        capturedAt: run.capturedAt,
        capturedCents: run.capturedCents ?? 0,
        refundedCents: refunded,
        instantPayoutFeeCents: fee,
        reimbursedCents: (run.capturedCents ?? 0) - refunded - fee,
      };
    });
    const sum = (key: keyof (typeof rows)[number]) =>
      rows.reduce((total, row) => total + (row[key] as number), 0);
    return {
      month,
      // Débours: never commissioned, never declared as earnings (DAC7).
      commissionCents: 0,
      rows,
      totals: {
        capturedCents: sum('capturedCents'),
        refundedCents: sum('refundedCents'),
        instantPayoutFeeCents: sum('instantPayoutFeeCents'),
        reimbursedCents: sum('reimbursedCents'),
      },
    };
  }

  // ---------------------------------------------------- disputes (admin)

  /** `POST /admin/groceries/disputes/{id}/fault`: who recovers a lost chargeback. */
  async declareFault(
    clerkUserId: string,
    disputeId: string,
    input: { fault: 'chef' | 'client' | 'platform'; note?: string },
  ) {
    const admin = await this.users.ensurePersistedFromClerk(clerkUserId);
    const dispute = await this.prisma.groceryDispute.findUnique({
      where: { id: disputeId },
      include: { payment: true },
    });
    if (!dispute) throw new NotFoundException('No such chargeback.');
    if (dispute.status !== 'lost') {
      throw new ConflictException({
        code: 'GROCERY_DISPUTE_OPEN',
        message:
          'Lab’s Food bears the chargeback while the bank handles it: wait for it to close.',
      });
    }
    if (dispute.fault) {
      throw new ConflictException({
        code: 'GROCERY_DISPUTE_DECIDED',
        message: 'The fault is already named.',
      });
    }
    let recoveryStatus = 'written_off';
    let recoveryReference: string | null = null;
    let recoveredAt: Date | null = null;
    if (input.fault === 'chef') {
      const reversal = await this.stripe.reverseTransfer({
        intentId: dispute.payment.stripePaymentIntentId!,
        amountCents: dispute.amountCents,
        key: dispute.id,
      });
      recoveryStatus = 'recovered';
      recoveryReference = reversal.id;
      recoveredAt = new Date();
    } else if (input.fault === 'client') {
      // Recovered by hand (a new payment, or a collection): the admin records it after.
      recoveryStatus = 'pending';
    }
    await this.prisma.groceryDispute.update({
      where: { id: dispute.id },
      data: {
        fault: input.fault,
        faultDeclaredAt: new Date(),
        faultDeclaredById: admin.id,
        recoveryStatus,
        recoveryReference,
        recoveredAt,
        notes: input.note?.trim() || dispute.notes,
      },
    });
    await this.audit.record({
      actorType: 'admin',
      actorUserId: admin.id,
      action: 'groceries.dispute_fault',
      subjectType: 'grocery_dispute',
      subjectId: dispute.id,
      metadata: { fault: input.fault, amountCents: dispute.amountCents, recoveryStatus },
    });
    return this.prisma.groceryDispute.findUniqueOrThrow({ where: { id: dispute.id } });
  }

  /** `POST /admin/groceries/disputes/{id}/recovered`: the client paid it back. */
  async markRecovered(clerkUserId: string, disputeId: string, reference: string) {
    const admin = await this.users.ensurePersistedFromClerk(clerkUserId);
    const updated = await this.prisma.groceryDispute.updateMany({
      where: { id: disputeId, recoveryStatus: 'pending' },
      data: {
        recoveryStatus: 'recovered',
        recoveryReference: reference.trim(),
        recoveredAt: new Date(),
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException({
        code: 'GROCERY_DISPUTE_NOT_PENDING',
        message: 'This chargeback is not waiting to be recovered from the client.',
      });
    }
    await this.audit.record({
      actorType: 'admin',
      actorUserId: admin.id,
      action: 'groceries.dispute_recovered',
      subjectType: 'grocery_dispute',
      subjectId: disputeId,
    });
    return this.prisma.groceryDispute.findUniqueOrThrow({ where: { id: disputeId } });
  }

  /**
   * `GET /admin/groceries`: the courses side of the money (motif « courses »), one row
   * per prestation, the most recent first.
   */
  async listRuns(status?: string) {
    const runs = await this.prisma.groceryRun.findMany({
      where: status ? { status: status as never } : {},
      orderBy: { updatedAt: 'desc' },
      take: 200,
      include: {
        lines: { select: { refundedCents: true, contestedAt: true, decision: true } },
        disputes: { select: { status: true, recoveryStatus: true } },
        booking: {
          select: {
            id: true,
            reference: true,
            startsAt: true,
            client: { select: { fullName: true, email: true } },
            chefProfile: { select: { id: true, displayName: true } },
          },
        },
      },
    });
    return runs.map((run) => ({
      id: run.id,
      purpose: 'courses' as const,
      status: run.status,
      budgetCents: run.budgetCents,
      holdPlacedAt: run.holdPlacedAt,
      holdExpiresAt: run.holdExpiresAt,
      holdFailureCode: run.holdFailureCode,
      receiptsTotalCents: run.receiptsTotalCents,
      capturedCents: run.capturedCents,
      capturedAt: run.capturedAt,
      refundedCents: run.lines.reduce((sum, line) => sum + line.refundedCents, 0),
      openContests: run.lines.filter((line) => line.contestedAt && !line.decision).length,
      disputes: run.disputes.length,
      disputesToRecover: run.disputes.filter(
        (d) =>
          d.recoveryStatus === 'pending' ||
          (d.status === 'lost' && d.recoveryStatus === 'none'),
      ).length,
      instantPayout: run.instantPayout,
      booking: {
        id: run.booking.id,
        reference: run.booking.reference,
        startsAt: run.booking.startsAt,
        clientName: run.booking.client.fullName ?? run.booking.client.email,
        chefProfileId: run.booking.chefProfile.id,
        chefName: run.booking.chefProfile.displayName,
      },
    }));
  }

  /** `GET /admin/groceries/disputes`: the chargebacks on groceries, newest first. */
  async listDisputes() {
    return this.prisma.groceryDispute.findMany({
      orderBy: { openedAt: 'desc' },
      take: 200,
      include: {
        groceryRun: {
          select: {
            booking: {
              select: {
                id: true,
                reference: true,
                chefProfile: { select: { displayName: true } },
              },
            },
          },
        },
      },
    });
  }

  // --------------------------------------------------------- webhooks

  /** Is this PaymentIntent a courses one? Answered by our row, never by metadata. */
  async isCoursesIntent(intentId: string): Promise<boolean> {
    const payment = await this.prisma.payment.findUnique({
      where: { stripePaymentIntentId: intentId },
      select: { purpose: true },
    });
    return payment?.purpose === 'courses';
  }

  /**
   * `payment_intent.*` on a courses payment. Captures are written synchronously; the
   * webhook only confirms them, and places a hold the client authenticated (3-D Secure).
   */
  async handleCoursesIntent(type: string, intent: Stripe.PaymentIntent) {
    const payment = await this.prisma.payment.findUnique({
      where: { stripePaymentIntentId: intent.id },
    });
    if (!payment) return;
    const run = await this.prisma.groceryRun.findFirst({
      where: { booking: { id: payment.bookingId } },
    });
    if (
      type === 'payment_intent.amount_capturable_updated' &&
      run?.status === 'hold_failed'
    ) {
      const now = new Date();
      await this.prisma.$transaction([
        this.prisma.payment.update({
          where: { id: payment.id },
          data: { status: 'pending', failureReason: null },
        }),
        this.prisma.groceryRun.update({
          where: { id: run.id },
          data: {
            status: 'hold_placed',
            holdPaymentId: payment.id,
            holdPlacedAt: now,
            holdExpiresAt: holdExpiry(now),
            holdFailedAt: null,
            holdFailureCode: null,
          },
        }),
      ]);
      const booking = await this.prisma.booking.findUniqueOrThrow({
        where: { id: payment.bookingId },
        select: BOOKING_SELECT,
      });
      await this.tell(booking.clientId, 'groceries.hold_placed', booking.id);
      await this.tell(
        booking.chefProfile.userId,
        'groceries.budget_guaranteed',
        booking.id,
      );
      return;
    }
    if (type === 'payment_intent.succeeded' && payment.status === 'pending') {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'succeeded',
          amountTtc: intent.amount_received,
          paidAt: new Date(),
        },
      });
    }
    if (type === 'payment_intent.canceled' && payment.status === 'pending') {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'failed', failureReason: 'Hold released.' },
      });
    }
  }

  /** `charge.dispute.*` on a courses payment: Lab's Food bears it while it is open. */
  async handleDispute(
    type: 'created' | 'closed',
    dispute: Stripe.Dispute,
  ): Promise<boolean> {
    const intentId =
      typeof dispute.payment_intent === 'string'
        ? dispute.payment_intent
        : dispute.payment_intent?.id;
    if (!intentId) return false;
    const payment = await this.prisma.payment.findUnique({
      where: { stripePaymentIntentId: intentId },
    });
    if (payment?.purpose !== 'courses') return false;
    const run = await this.prisma.groceryRun.findFirst({
      where: { bookingId: payment.bookingId },
    });
    if (!run) return false;
    if (type === 'created') {
      await this.prisma.groceryDispute.upsert({
        where: { stripeDisputeId: dispute.id },
        update: {},
        create: {
          groceryRunId: run.id,
          paymentId: payment.id,
          stripeDisputeId: dispute.id,
          amountCents: dispute.amount,
          reason: dispute.reason,
        },
      });
    } else {
      const lost = dispute.status === 'lost';
      await this.prisma.groceryDispute.updateMany({
        where: { stripeDisputeId: dispute.id },
        data: {
          status: lost ? 'lost' : dispute.status === 'won' ? 'won' : dispute.status,
          closedAt: new Date(),
          ...(lost ? {} : { recoveryStatus: 'none' }),
        },
      });
    }
    await this.audit.record({
      actorType: 'system',
      action: `groceries.dispute_${type}`,
      subjectType: 'grocery_run',
      subjectId: run.id,
      metadata: {
        stripeDisputeId: dispute.id,
        amountCents: dispute.amount,
        status: dispute.status,
      },
    });
    return true;
  }

  /**
   * Brevo's transactional webhook (`delivered`, bounces): the proof of delivery of the
   * message before the groceries, the condition for the silence to confirm.
   */
  async handleBrevoEvent(payload: {
    event?: string;
    'message-id'?: string;
    date?: string;
    ts_event?: number;
  }) {
    const messageId = payload['message-id'];
    if (!messageId || !payload.event) return { matched: false };
    const at = payload.ts_event
      ? new Date(payload.ts_event * 1000)
      : payload.date
        ? new Date(payload.date)
        : new Date();
    const when = Number.isNaN(at.getTime()) ? new Date() : at;
    const event = payload.event.toLowerCase();
    const bounced = [
      'hard_bounce',
      'soft_bounce',
      'blocked',
      'invalid_email',
      'error',
      'spam',
    ].includes(event);
    const { count } = await this.prisma.groceryRun.updateMany({
      where: { emailMessageId: messageId },
      data: {
        emailLastEvent: event.slice(0, 32),
        ...(event === 'delivered' ? { emailDeliveredAt: when } : {}),
        ...(bounced ? { emailBouncedAt: when } : {}),
      },
    });
    if (count) this.logger.log({ event: 'groceries.email_event', kind: event });
    return { matched: count > 0 };
  }

  // ------------------------------------------------------------- the clock

  /** Holds due at the lock, for every run whose card is saved. */
  async placeDueHolds(now: Date) {
    const runs = await this.prisma.groceryRun.findMany({
      where: {
        status: 'card_saved',
        booking: { status: { in: ['confirmed', 'shopping'] } },
      },
      select: {
        id: true,
        mandateRules: true,
        budgetCents: true,
        booking: { select: { startsAt: true } },
      },
      take: 200,
    });
    let placed = 0;
    for (const run of runs) {
      if (now < lockAt(run.booking.startsAt, this.rulesOf(run))) continue;
      if ((await this.placeHold(run.id, now)) === 'placed') placed += 1;
    }
    return placed;
  }

  /** The cancel deadline passed: the click, or the silence, or « en attente du client ». */
  async handleDeadlines(now: Date) {
    const settings = await groceriesInForce(this.prisma);
    const runs = await this.prisma.groceryRun.findMany({
      where: {
        status: 'notice_sent',
        cancelDeadline: { lte: now },
        deadlineHandledAt: null,
      },
      include: { booking: { select: BOOKING_SELECT } },
      take: 200,
    });
    let handled = 0;
    for (const run of runs) {
      const outcome = deadlineOutcome({
        status: run.status as RunStatus,
        cancelDeadline: run.cancelDeadline,
        emailDeliveredAt: run.emailDeliveredAt,
        emailBouncedAt: run.emailBouncedAt,
        silenceConfirms: settings.silenceConfirms,
        now,
      });
      if (!outcome) continue;
      const claimed = await this.prisma.groceryRun.updateMany({
        where: { id: run.id, status: 'notice_sent', deadlineHandledAt: null },
        data: {
          deadlineHandledAt: now,
          status: outcome,
          ...(outcome === 'confirmed'
            ? { confirmedAt: now, confirmedBy: 'silence' }
            : {}),
        },
      });
      if (claimed.count !== 1) continue;
      handled += 1;
      if (outcome === 'confirmed') {
        await this.tell(
          run.booking.chefProfile.userId,
          'groceries.confirmed',
          run.bookingId,
        );
      } else {
        await this.tell(
          run.booking.chefProfile.userId,
          'groceries.awaiting_client',
          run.bookingId,
        );
        await this.tell(run.booking.clientId, 'groceries.confirm_needed', run.bookingId);
      }
    }
    return handled;
  }

  /**
   * A refused hold never fixed by the shopping deadline (noon the day before): a late
   * refusal, the client shops. And a cancelled prestation releases its hold.
   */
  async closeStaleRuns(now: Date) {
    let closed = 0;
    const failed = await this.prisma.groceryRun.findMany({
      where: { status: { in: ['hold_failed', 'card_saved', 'awaiting_card'] } },
      include: { booking: { select: BOOKING_SELECT } },
      take: 200,
    });
    for (const run of failed) {
      if (now < shoppingDeadline(run.booking.startsAt)) continue;
      await this.cancelRun(
        run,
        run.booking,
        'system',
        'No hold on the card by the shopping deadline.',
        now,
      );
      closed += 1;
    }
    const orphans = await this.prisma.groceryRun.findMany({
      where: {
        status: { notIn: ['cancelled', 'captured', 'settled'] },
        booking: { status: 'cancelled' },
      },
      include: { booking: { select: BOOKING_SELECT } },
      take: 200,
    });
    for (const run of orphans) {
      if (run.receiptsSubmittedAt) continue;
      await this.cancelRun(
        run,
        run.booking,
        'system',
        'The prestation was cancelled.',
        now,
      );
      closed += 1;
    }
    return closed;
  }

  /** The captures due: 24 h after the deposit, or 6 h before the hold expires. */
  async captureDue(now: Date) {
    const runs = await this.prisma.groceryRun.findMany({
      where: {
        status: {
          in: ['receipts_submitted', 'confirmed', 'notice_sent', 'awaiting_client'],
        },
        capturedAt: null,
        holdPaymentId: { not: null },
      },
      include: { lines: true, booking: { select: BOOKING_SELECT } },
      take: 200,
    });
    let captured = 0;
    for (const run of runs) {
      const due =
        (run.status === 'receipts_submitted' &&
          run.captureDueAt &&
          now >= run.captureDueAt) ||
        safetyCaptureDue(run.holdExpiresAt, now);
      if (!due) continue;
      if (await this.capture(run, now)) captured += 1;
    }
    return captured;
  }

  private async capture(
    run: Prisma.GroceryRunGetPayload<{
      include: { lines: true; booking: { select: typeof BOOKING_SELECT } };
    }>,
    now: Date,
  ): Promise<boolean> {
    const claimed = await this.prisma.groceryRun.updateMany({
      where: {
        id: run.id,
        capturedAt: null,
        OR: [
          { captureClaimedAt: null },
          { captureClaimedAt: { lt: new Date(now.getTime() - CLAIM_STALE_MS) } },
        ],
      },
      data: { captureClaimedAt: now },
    });
    if (claimed.count !== 1) return false;
    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: run.holdPaymentId! },
    });
    const withReceipts = run.receiptsSubmittedAt !== null;
    // Not confirmed by the client and the hold expiring: nothing is bought, release it.
    const unconfirmed = ['notice_sent', 'awaiting_client'].includes(run.status);
    const safety = !withReceipts && !unconfirmed;
    const amount = unconfirmed
      ? 0
      : safety
        ? run.budgetCents
        : captureAmount(run.lines, run.budgetCents);
    const settings = await groceriesInForce(this.prisma);
    const fee = run.instantPayout && amount > 0 ? instantPayoutFee(amount, settings) : 0;
    try {
      if (amount === 0) {
        await this.stripe.cancelHold(payment.stripePaymentIntentId!, run.id);
      } else {
        await this.stripe.capture(payment.stripePaymentIntentId!, amount, fee, run.id);
      }
    } catch (error) {
      await this.prisma.groceryRun.update({
        where: { id: run.id },
        data: {
          captureClaimedAt: null,
          captureError: String((error as Error).message).slice(0, 500),
        },
      });
      this.logger.error(
        { event: 'groceries.capture_failed', groceryRunId: run.id },
        stackOf(error),
      );
      return false;
    }
    await this.prisma.$transaction([
      this.prisma.payment.update({
        where: { id: payment.id },
        data:
          amount === 0
            ? { status: 'failed', failureReason: 'Nothing to reimburse: hold released.' }
            : { status: 'succeeded', amountTtc: amount, paidAt: now },
      }),
      this.prisma.groceryRun.update({
        where: { id: run.id },
        data: unconfirmed
          ? {
              status: 'cancelled',
              cancelledAt: now,
              cancelledBy: 'system',
              cancelReason: 'Not confirmed before the hold expired.',
              captureError: null,
            }
          : {
              status: 'captured',
              capturedAt: now,
              capturedCents: amount,
              releasedCents: run.budgetCents - amount,
              safetyCapture: safety,
              captureError: null,
              instantPayoutFeeCents: fee || run.instantPayoutFeeCents,
            },
      }),
    ]);
    if (unconfirmed) {
      await this.tell(
        run.booking.chefProfile.userId,
        'groceries.cancelled',
        run.bookingId,
      );
      return true;
    }
    await this.tell(run.booking.clientId, 'groceries.captured', run.bookingId);
    await this.tell(run.booking.chefProfile.userId, 'groceries.captured', run.bookingId);
    await this.audit.record({
      actorType: 'system',
      action: 'groceries.captured',
      subjectType: 'grocery_run',
      subjectId: run.id,
      // A courses payment never carries a commission: there is no Commission row.
      metadata: {
        amountCents: amount,
        releasedCents: run.budgetCents - amount,
        safety,
        instantFeeCents: fee,
      },
    });
    if (run.instantPayout && amount > fee && run.booking.chefProfile.stripeAccountId) {
      await this.instantPayout(
        run.id,
        run.booking.chefProfile.stripeAccountId,
        amount - fee,
        payment.stripePaymentIntentId!,
      );
    }
    return true;
  }

  private async instantPayout(
    runId: string,
    accountId: string,
    amountCents: number,
    intentId: string,
  ) {
    try {
      const payout = await this.stripe.instantPayout({ accountId, amountCents, runId });
      await this.prisma.groceryRun.update({
        where: { id: runId },
        data: { instantPayoutId: payout.id, instantPayoutStatus: payout.status },
      });
    } catch (error) {
      // Not instant after all: the standard payout applies, and the fee goes back.
      await this.stripe.refundInstantFee(intentId, runId).catch(() => null);
      await this.prisma.groceryRun.update({
        where: { id: runId },
        data: { instantPayoutStatus: 'failed', instantPayoutFeeCents: 0 },
      });
      this.logger.warn({
        event: 'groceries.instant_payout_failed',
        groceryRunId: runId,
        message: (error as Error).message,
      });
    }
  }

  /** After a safety capture, the receipts are in: the difference goes back. */
  private async refundSafetyDifference(runId: string) {
    const run = await this.prisma.groceryRun.findUniqueOrThrow({
      where: { id: runId },
      include: { lines: true },
    });
    const due = (run.capturedCents ?? 0) - captureAmount(run.lines, run.budgetCents);
    if (due <= 0 || !run.holdPaymentId) return;
    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: run.holdPaymentId },
    });
    const refund = await this.stripe.refund({
      intentId: payment.stripePaymentIntentId!,
      amountCents: due,
      key: `${run.id}-safety`,
    });
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        refundedAmount: (payment.refundedAmount ?? 0) + due,
        refundedAt: new Date(),
        status: 'partially_refunded',
        metadata: { ...(payment.metadata as object), safetyRefundId: refund.id },
      },
    });
    await this.prisma.groceryRun.update({
      where: { id: run.id },
      data: { releasedCents: (run.releasedCents ?? 0) + due },
    });
  }

  /** Settled once the contest window is closed and every contest decided. */
  async settleDue(now: Date) {
    const runs = await this.prisma.groceryRun.findMany({
      where: { status: 'captured', settledAt: null, receiptsSubmittedAt: { not: null } },
      include: { lines: true },
      take: 200,
    });
    let settled = 0;
    for (const run of runs) {
      if (!settles(run.contestClosesAt, run.lines, now)) continue;
      const { count } = await this.prisma.groceryRun.updateMany({
        where: { id: run.id, status: 'captured' },
        data: { status: 'settled', settledAt: now },
      });
      settled += count;
    }
    return settled;
  }

  private async tell(userId: string, type: string, bookingId: string) {
    try {
      return await this.notifications.notify(userId, type, {
        type: 'booking',
        id: bookingId,
      });
    } catch (error) {
      this.logger.error(
        { event: 'groceries.notify_failed', type, bookingId },
        stackOf(error),
      );
      return null;
    }
  }
}
