import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TAX_CREDIT_BPS } from '../platform-settings/pricing.constants';
import { UsersService } from '../users/users.service';
import { CommissionDebitsService } from './commission-debits.service';
import { commissionForPayment } from './commission-policy';
import { assertPayable, paymentPhase } from './payment-rules';
import {
  assertNoPendingCesu,
  bookingCoverage,
  settlePayment,
} from './payment-settlement';
import { UrssafGateway } from './urssaf.gateway';

const BPS = 10_000;

/** What the payment screen shows for the prestation as a whole (FLOW-03 §2). */
export type BookingPaymentState = 'not-due' | 'due' | 'processing' | 'paid' | 'failed';

export type UrssafReasonCode =
  'URSSAF_LINK_NONE' | 'URSSAF_LINK_PENDING' | 'URSSAF_LINK_REFUSED';

/** Why a method is blocked: the advance's own codes, or a CESU declaration under way. */
export type MethodReasonCode = UrssafReasonCode | 'CESU_PENDING';

const CESU_PENDING_REASON =
  'Vos titres CESU attendent la confirmation du batch cooker : le solde se règle ensuite.';

/** Shown as written by the site: addressed to the client, in French. */
const URSSAF_REASON: Record<UrssafReasonCode, string> = {
  URSSAF_LINK_NONE:
    'L’avance immédiate demande un rattachement à ce batch cooker, à faire une fois.',
  URSSAF_LINK_PENDING: 'Votre demande de rattachement est en cours d’instruction.',
  URSSAF_LINK_REFUSED: 'L’URSSAF a refusé le rattachement à ce batch cooker.',
};

const REASONS: Record<MethodReasonCode, string> = {
  ...URSSAF_REASON,
  CESU_PENDING: CESU_PENDING_REASON,
};

export interface PaymentMethodOption {
  id: 'urssaf' | 'card' | 'cesu';
  available: boolean;
  reasonCode?: MethodReasonCode;
  reason?: string;
  /** What the client pays on the site, now, with this method. */
  dueNowCents: number;
  /** Immediate advance only: what URSSAF takes from their account afterwards. */
  debitedLaterCents?: number;
  /** CESU only: the most that can be declared, and the number to pay the cook with. */
  maxCesuCents?: number;
  crcesuNan?: string | null;
}

const afterTaxCredit = (cents: number) =>
  Math.round((cents * (BPS - TAX_CREDIT_BPS)) / BPS);

/**
 * Paying a prestation, seen from the booking: which methods this client can use
 * with this batch cooker, and the immediate advance.
 *
 * Card and CESU keep their own services; this one answers the question the screen
 * asks first, and carries the method that moves no money on the site.
 */
@Injectable()
export class BookingPaymentsService {
  private readonly logger = new Logger(BookingPaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
    private readonly urssaf: UrssafGateway,
    private readonly commissionDebits: CommissionDebitsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * `GET /me/bookings/{id}/payment-options`.
   *
   * A method the batch cooker does not take is **left out**: the client has no
   * business knowing what their cook refuses. One they take but that is blocked for
   * this client comes back `available: false` with the reason.
   */
  async options(clerkUserId: string, bookingId: string) {
    const { booking, client } = await this.ownBooking(clerkUserId, bookingId);
    const chef = booking.chefProfile;
    const coverage = await bookingCoverage(this.prisma, booking);
    const remaining = coverage.remainingAmountCents;
    const methods: PaymentMethodOption[] = [];
    const cesuPending =
      (await this.prisma.payment.count({
        where: { bookingId: booking.id, method: 'cesu', status: 'pending' },
      })) > 0;

    if (
      this.urssaf.enabled &&
      chef.sapProfile?.urssafTiersPrestationStatus === 'active'
    ) {
      const link = await this.prisma.urssafLink.findUnique({
        where: {
          clientId_chefProfileId: { clientId: client.id, chefProfileId: chef.id },
        },
      });
      const reasonCode: MethodReasonCode | null = cesuPending
        ? 'CESU_PENDING'
        : link?.status === 'active'
          ? null
          : link?.status === 'pending'
            ? 'URSSAF_LINK_PENDING'
            : link?.status === 'refused'
              ? 'URSSAF_LINK_REFUSED'
              : 'URSSAF_LINK_NONE';
      methods.push({
        id: 'urssaf',
        available: reasonCode === null,
        ...(reasonCode ? { reasonCode, reason: REASONS[reasonCode] } : {}),
        // Nothing is paid on the site: URSSAF debits the client's share afterwards.
        dueNowCents: 0,
        debitedLaterCents: afterTaxCredit(remaining),
      });
    }
    if (chef.stripeAccountId && chef.stripeChargesEnabled && chef.stripePayoutsEnabled) {
      methods.push({
        id: 'card',
        available: !cesuPending,
        ...(cesuPending
          ? { reasonCode: 'CESU_PENDING' as const, reason: CESU_PENDING_REASON }
          : {}),
        dueNowCents: remaining,
      });
    }
    if (chef.sapProfile?.acceptsCesu && chef.sapProfile.crcesuNan) {
      methods.push({
        id: 'cesu',
        available: true,
        dueNowCents: remaining,
        maxCesuCents: remaining,
        crcesuNan: chef.sapProfile.crcesuNan,
      });
    }

    return {
      bookingId: booking.id,
      reference: booking.reference,
      // Who is paid, and the id an enrolment is asked with (`POST /me/urssaf-links`).
      chef: { chefProfileId: chef.id, displayName: chef.displayName },
      startsAt: booking.startsAt,
      status: await this.state(booking, coverage.fullyCovered),
      // The day the prestation ends is the day its payment falls due.
      dueAt: booking.endsAt.toISOString().slice(0, 10),
      amounts: {
        totalCents: coverage.amountTtcCents,
        paidCents: coverage.coveredAmountCents,
        remainingCents: remaining,
        taxCreditCents: coverage.amountTtcCents - afterTaxCredit(coverage.amountTtcCents),
        currency: booking.currency.toLowerCase(),
      },
      methods,
      // ponytail: no Stripe customer is kept per client yet, so no card is remembered.
      savedCards: [] as never[],
    };
  }

  private async state(
    booking: {
      id: string;
      status: Parameters<typeof paymentPhase>[0]['status'];
      endsAt: Date;
    },
    fullyCovered: boolean,
  ): Promise<BookingPaymentState> {
    if (fullyCovered) return 'paid';
    if (paymentPhase(booking) !== 'due') return 'not-due';

    const last = await this.prisma.payment.findFirst({
      where: { bookingId: booking.id },
      orderBy: { createdAt: 'desc' },
      select: { method: true, status: true },
    });
    // A card page left open is not a payment under way: only what waits on someone
    // else (the cook confirming CESU, URSSAF answering) is `processing`.
    if (last?.status === 'pending' && last.method !== 'cb') return 'processing';
    if (last?.status === 'failed') return 'failed';
    return 'due';
  }

  /**
   * `POST /bookings/{id}/settle` with `method: urssaf` (FLOW-03 §2 bis).
   *
   * The client confirms the prestation took place and nothing is charged here: the
   * request goes to URSSAF, which debits the client's share and pays the batch cooker.
   * The answer is never "paid": the prestation is `processing` until URSSAF says so.
   * The commission cannot be withheld from money that never crosses the platform, so
   * it is invoiced and debited afterwards, like CESU.
   */
  async settleWithUrssaf(clerkUserId: string, bookingId: string) {
    this.assertEnabled();
    const { booking, client } = await this.ownBooking(clerkUserId, bookingId);
    assertPayable(booking);

    const chef = booking.chefProfile;
    if (chef.sapProfile?.urssafTiersPrestationStatus !== 'active') {
      throw new ConflictException({
        code: 'URSSAF_NOT_ACCEPTED',
        message: 'This batch cooker does not take the immediate advance.',
      });
    }
    const link = await this.prisma.urssafLink.findUnique({
      where: { clientId_chefProfileId: { clientId: client.id, chefProfileId: chef.id } },
    });
    if (link?.status !== 'active') {
      throw new ConflictException({
        code: !link
          ? 'URSSAF_LINK_NONE'
          : link.status === 'pending'
            ? 'URSSAF_LINK_PENDING'
            : 'URSSAF_LINK_REFUSED',
        message: 'The client is not enrolled with this batch cooker at URSSAF.',
      });
    }

    await assertNoPendingCesu(this.prisma, booking.id);
    const coverage = await bookingCoverage(this.prisma, booking);
    const amountTtc = coverage.remainingAmountCents;
    if (amountTtc <= 0) {
      throw new ConflictException('This booking is already fully paid.');
    }
    const debitedCents = afterTaxCredit(amountTtc);
    const commission = await commissionForPayment(this.prisma, booking, amountTtc, {
      rateBps: this.config.get<number>('payments.commissionRateBps', 1500),
      vatRateBps: this.config.get<number>('payments.commissionVatRateBps', 2000),
    });

    let paymentId: string;
    try {
      const payment = await this.prisma.payment.create({
        data: {
          bookingId: booking.id,
          method: 'avance_immediate',
          status: 'pending',
          amountTtc,
          currency: booking.currency,
          commission: {
            create: {
              chefProfileId: chef.id,
              rateBps: commission.rateBps,
              vatRateBps: commission.vatRateBps,
              basisAmountCents: amountTtc,
              amountHtCents: commission.amountHtCents,
              amountVatCents: commission.amountVatCents,
              amountTtcCents: commission.amountTtcCents,
              collectionMethod: 'sepa_direct_debit',
              status: 'pending',
            },
          },
        },
      });
      paymentId = payment.id;
    } catch (error) {
      // `uq_payments_live_avance_booking_id`: a second click while the first waits.
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException({
          code: 'URSSAF_REQUEST_PENDING',
          message: 'This prestation is already with URSSAF.',
        });
      }
      throw error;
    }

    let transmission: Awaited<ReturnType<UrssafGateway['submitPaymentRequest']>>;
    try {
      transmission = await this.urssaf.submitPaymentRequest({
        bookingId: booking.id,
        bookingReference: booking.reference,
        amountCents: amountTtc,
        clientShareCents: debitedCents,
      });
    } catch (error) {
      // Nothing left URSSAF's way: the request must not keep the booking `processing`.
      await this.fail(paymentId, 'The request could not be sent to URSSAF.');
      this.logger.error(
        `URSSAF request for booking ${booking.id} failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      throw new ServiceUnavailableException({
        code: 'URSSAF_UNAVAILABLE',
        message: 'URSSAF could not be reached. Try again, or pay another way.',
      });
    }

    await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        metadata: {
          urssafReference: transmission.reference,
          urssafGateway: this.urssaf.mode,
          transmittedAt: transmission.transmittedAt.toISOString(),
          debitedCents,
        },
      },
    });
    this.logger.log(`Booking ${booking.id} sent to URSSAF (payment ${paymentId}).`);

    return {
      paymentId,
      status: 'processing' as const,
      debitedCents,
      transmittedAt: transmission.transmittedAt,
    };
  }

  /**
   * URSSAF's answer to a payment request.
   *
   * `paid`: the payment settles like any other and the commission falls due.
   * `refused`: the payment fails and the prestation is due again, with the other
   * methods still on offer. The client is never left in a dead end.
   *
   * Called by an admin while the gateway is simulated; URSSAF's own notification
   * will call it once the live gateway exists.
   */
  async recordUrssafOutcome(
    paymentId: string,
    outcome: 'paid' | 'refused',
    reason?: string,
  ) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, method: 'avance_immediate' },
      select: { id: true, bookingId: true, amountTtc: true, status: true },
    });
    if (!payment) {
      throw new NotFoundException('No immediate-advance request with this id.');
    }
    if (payment.status !== 'pending') {
      throw new ConflictException({
        code: 'URSSAF_REQUEST_SETTLED',
        message: `This request is already ${payment.status}.`,
      });
    }

    if (outcome === 'refused') {
      await this.fail(payment.id, reason?.trim() || 'URSSAF refused the debit.');
      return { paymentId: payment.id, status: 'failed' as const };
    }

    const paidAt = new Date();
    const commissionId = await this.prisma.$transaction(async (tx) => {
      // Conditional on `pending`: two answers for one request settle it once.
      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, status: 'pending' },
        data: { updatedAt: paidAt },
      });
      if (claimed.count === 0) {
        throw new ConflictException('This request has already been settled.');
      }
      await settlePayment(tx, payment, { paidAt });
      const commission = await tx.commission.findUnique({
        where: { paymentId: payment.id },
        select: { id: true },
      });
      return commission?.id ?? null;
    });
    // After the commit, and never fatal: the batch cooker is paid whatever happens
    // to the platform's own commission (see `CesuPaymentsService.settleDeclaration`).
    if (commissionId) await this.commissionDebits.onCommissionDue(commissionId);

    return { paymentId: payment.id, status: 'succeeded' as const };
  }

  private async fail(paymentId: string, reason: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.updateMany({
        where: { id: paymentId, status: 'pending' },
        data: { status: 'failed', failureReason: reason },
      });
      await tx.commission.updateMany({
        where: { paymentId },
        data: { status: 'failed' },
      });
    });
  }

  // ── Enrolment of a client with a batch cooker ──

  /** `GET /me/urssaf-links`: where the client stands with each batch cooker. */
  async myLinks(clerkUserId: string) {
    const client = await this.users.ensurePersistedFromClerk(clerkUserId);
    const links = await this.prisma.urssafLink.findMany({
      where: { clientId: client.id },
      include: { chefProfile: { select: { id: true, displayName: true } } },
      orderBy: { requestedAt: 'desc' },
    });
    return links.map((link) => this.linkView(link));
  }

  /**
   * `POST /me/urssaf-links`: the client asks to be enrolled with a batch cooker.
   * Asking again after a refusal reopens the request; asking twice changes nothing.
   */
  async requestLink(clerkUserId: string, chefProfileId: string) {
    this.assertEnabled();
    const client = await this.users.ensurePersistedFromClerk(clerkUserId);
    const chef = await this.prisma.chefProfile.findFirst({
      where: { id: chefProfileId, isVerified: true },
      select: {
        id: true,
        userId: true,
        sapProfile: { select: { urssafTiersPrestationStatus: true } },
      },
    });
    if (!chef || chef.sapProfile?.urssafTiersPrestationStatus !== 'active') {
      throw new UnprocessableEntityException({
        code: 'URSSAF_NOT_ACCEPTED',
        message: 'This batch cooker does not take the immediate advance.',
      });
    }
    if (chef.userId === client.id) {
      throw new UnprocessableEntityException({
        code: 'SAME_PERSON',
        message: 'A batch cooker cannot enrol with themselves.',
      });
    }

    const key = { clientId: client.id, chefProfileId: chef.id };
    const existing = await this.prisma.urssafLink.findUnique({
      where: { clientId_chefProfileId: key },
    });
    const link =
      existing && existing.status !== 'refused'
        ? existing
        : await this.prisma.urssafLink.upsert({
            where: { clientId_chefProfileId: key },
            create: key,
            update: {
              status: 'pending',
              refusalReason: null,
              decidedAt: null,
              requestedAt: new Date(),
            },
          });
    return this.linkView(
      await this.prisma.urssafLink.findUniqueOrThrow({
        where: { id: link.id },
        include: { chefProfile: { select: { id: true, displayName: true } } },
      }),
    );
  }

  /** `GET /admin/urssaf-links`: the enrolments, the ones waiting first. */
  async adminLinks(status?: 'pending' | 'active' | 'refused') {
    const links = await this.prisma.urssafLink.findMany({
      where: status ? { status } : {},
      include: {
        chefProfile: { select: { id: true, displayName: true } },
        client: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: [{ status: 'asc' }, { requestedAt: 'desc' }],
      take: 200,
    });
    return links.map((link) => ({
      ...this.linkView(link),
      client: {
        id: link.client.id,
        name: link.client.fullName,
        email: link.client.email,
      },
    }));
  }

  /** An admin answers an enrolment in URSSAF's place. Simulated gateway only. */
  async decideLink(
    adminClerkUserId: string,
    linkId: string,
    decision: 'active' | 'refused',
    reason: string | undefined,
    requestId?: string,
  ) {
    this.assertSimulated();
    const admin = await this.users.ensurePersistedFromClerk(adminClerkUserId);
    const link = await this.prisma.urssafLink.findUnique({ where: { id: linkId } });
    if (!link) throw new NotFoundException('No enrolment with this id.');

    const updated = await this.prisma.urssafLink.update({
      where: { id: linkId },
      data: {
        status: decision,
        refusalReason: decision === 'refused' ? reason?.trim() || null : null,
        decidedAt: new Date(),
      },
      include: { chefProfile: { select: { id: true, displayName: true } } },
    });
    await this.audit.record({
      actorType: 'admin',
      actorUserId: admin.id,
      action: 'urssaf.link_simulated',
      subjectType: 'urssaf_link',
      subjectId: linkId,
      metadata: { from: link.status, to: decision },
      requestId,
    });
    return this.linkView(updated);
  }

  /** `GET /admin/urssaf-payments`: the requests waiting for URSSAF. */
  async adminPayments() {
    const payments = await this.prisma.payment.findMany({
      where: { method: 'avance_immediate' },
      include: {
        booking: {
          select: {
            id: true,
            reference: true,
            client: { select: { fullName: true, email: true } },
            chefProfile: { select: { displayName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return payments.map((payment) => ({
      paymentId: payment.id,
      status: payment.status,
      amountCents: payment.amountTtc,
      debitedCents:
        (payment.metadata as { debitedCents?: number } | null)?.debitedCents ?? null,
      urssafReference:
        (payment.metadata as { urssafReference?: string } | null)?.urssafReference ??
        null,
      failureReason: payment.failureReason,
      createdAt: payment.createdAt,
      paidAt: payment.paidAt,
      booking: {
        id: payment.booking.id,
        reference: payment.booking.reference,
        clientName: payment.booking.client.fullName ?? payment.booking.client.email,
        chefName: payment.booking.chefProfile.displayName,
      },
    }));
  }

  /** An admin answers a payment request in URSSAF's place. Simulated gateway only. */
  async simulateOutcome(
    adminClerkUserId: string,
    paymentId: string,
    outcome: 'paid' | 'refused',
    reason: string | undefined,
    requestId?: string,
  ) {
    this.assertSimulated();
    const admin = await this.users.ensurePersistedFromClerk(adminClerkUserId);
    const result = await this.recordUrssafOutcome(paymentId, outcome, reason);
    await this.audit.record({
      actorType: 'admin',
      actorUserId: admin.id,
      action: 'urssaf.payment_simulated',
      subjectType: 'payment',
      subjectId: paymentId,
      metadata: { outcome },
      requestId,
    });
    return result;
  }

  // ── Shared ──

  private async ownBooking(clerkUserId: string, bookingId: string) {
    const client = await this.users.ensurePersistedFromClerk(clerkUserId);
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, clientId: client.id },
      include: { chefProfile: { include: { sapProfile: true } } },
    });
    if (!booking) throw new NotFoundException('Booking not found.');
    return { booking, client };
  }

  private linkView(link: {
    id: string;
    status: string;
    refusalReason: string | null;
    requestedAt: Date;
    decidedAt: Date | null;
    chefProfile: { id: string; displayName: string };
  }) {
    return {
      id: link.id,
      chefProfileId: link.chefProfile.id,
      chefName: link.chefProfile.displayName,
      status: link.status,
      refusalReason: link.refusalReason,
      requestedAt: link.requestedAt,
      decidedAt: link.decidedAt,
    };
  }

  private assertEnabled(): void {
    if (!this.urssaf.enabled) {
      throw new ServiceUnavailableException({
        code: 'URSSAF_UNAVAILABLE',
        message: 'The immediate advance is not open yet.',
      });
    }
  }

  private assertSimulated(): void {
    if (!this.urssaf.simulated) {
      throw new ForbiddenException({
        code: 'URSSAF_NOT_SIMULATED',
        message: 'Only a simulated gateway lets an admin answer for URSSAF.',
      });
    }
  }
}
