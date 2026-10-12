import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { CesuSettlementStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { CHEF_CESU_INFO_SELECT, toChefCesuInfo } from './chef-cesu-info';
import { CommissionDebitsService } from './commission-debits.service';
import { assertNoCommissionBlock } from './commission-standing';
import { computeCommission } from './commission.util';
import {
  BookingPaymentStatusDto,
  CesuPaymentDto,
  ChefCesuInfoDto,
  DeclareCesuPaymentDto,
} from './dto/cesu.dto';
import { bookingCoverage, settlePayment } from './payment-settlement';

/** Rows the list/detail mappers read. */
const CESU_PAYMENT_INCLUDE = {
  cesuSettlement: true,
  booking: {
    select: {
      id: true,
      reference: true,
      chefProfileId: true,
      clientId: true,
      client: { select: { fullName: true, email: true } },
      chefProfile: { select: { id: true, displayName: true, userId: true } },
    },
  },
  commission: { select: { id: true } },
} as const;

/**
 * Prefinanced CESU, electronic first.
 *
 * What makes this flow different from the card one is that **the funds never transit
 * through the platform**. The client pushes the payment from their issuer's beneficiary
 * area (Pluxee, Edenred, UP, BIMPLI, Domiserve) using the chef's NAN, and the issuer
 * credits the chef directly. So:
 *
 * - the API can only *record* a declaration, never charge anything;
 * - no issuer exposes an API, no transaction reference is normalised, and Domiserve runs
 *   outside the CRCESU entirely — **nothing here is programmatically verifiable**;
 * - the chef confirms receipt, because the chef is who gets the issuer's notification and
 *   the money. An admin can override, and that override is traced;
 * - the platform's commission cannot be withheld at charge time, so it is invoiced
 *   (facture B) and collected by SEPA direct debit — see `CommissionDebitsService`.
 *
 * Titre expiry is a non-issue: the issuer's portal refuses to spend an expired titre.
 */
@Injectable()
export class CesuPaymentsService {
  private readonly logger = new Logger(CesuPaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly users: UsersService,
    private readonly commissionDebits: CommissionDebitsService,
  ) {}

  /**
   * `POST /payments/cesu`. Opens a `pending` CESU payment plus its `pending` commission
   * and a `declared` settlement, in one transaction.
   *
   * The declared amount is capped at what is **left to cover**, never at the booking
   * total: a booking may be part CESU and part card, and CRCESU rules forbid charging the
   * client anything on top — which is why this route has no fee field at all.
   */
  async declare(
    clerkUserId: string,
    payload: DeclareCesuPaymentDto,
  ): Promise<CesuPaymentDto> {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    const booking = await this.prisma.booking.findFirst({
      where: { id: payload.bookingId, clientId: user.id },
      include: { chefProfile: { include: { sapProfile: true } } },
    });
    if (!booking) {
      throw new NotFoundException('Booking not found.');
    }
    if (booking.status !== 'pending') {
      throw new ConflictException(
        `Booking ${booking.id} is ${booking.status}; only a pending booking can be paid.`,
      );
    }

    const chef = booking.chefProfile;
    // Re-checked here, not only at booking time: vetting can be revoked in between, and
    // this is what puts a chef's NAN in front of a paying client.
    if (!chef.isActive || !chef.isVerified) {
      throw new ConflictException(
        'The chef is not verified by an admin, so this booking cannot be paid.',
      );
    }
    if (!chef.sapProfile?.acceptsCesu || !chef.sapProfile.crcesuNan) {
      throw new ConflictException(
        'This chef does not accept prefinanced CESU (no opt-in, or no CRCESU affiliation number).',
      );
    }
    // §6 guard: an uncollectable commission stops the chef taking on new work.
    await assertNoCommissionBlock(
      this.prisma,
      chef.id,
      this.commissionDebits.maxAttempts,
    );

    const coverage = await bookingCoverage(this.prisma, booking);
    if (coverage.remainingAmountCents <= 0) {
      throw new ConflictException('This booking is already fully paid.');
    }
    if (payload.amountTtc > coverage.remainingAmountCents) {
      throw new ConflictException(
        `Only ${coverage.remainingAmountCents} minor units are left to pay on this booking. ` +
          'A CESU declaration can never exceed the amount due — CRCESU rules forbid any surcharge.',
      );
    }

    const commission = computeCommission(payload.amountTtc, {
      rateBps: this.config.get<number>('payments.commissionRateBps', 1500),
      vatRateBps: this.config.get<number>('payments.commissionVatRateBps', 2000),
    });

    try {
      const payment = await this.prisma.payment.create({
        data: {
          bookingId: booking.id,
          method: 'cesu',
          status: 'pending',
          amountTtc: payload.amountTtc,
          currency: booking.currency,
          commission: {
            create: {
              chefProfileId: chef.id,
              rateBps: commission.rateBps,
              vatRateBps: commission.vatRateBps,
              basisAmountCents: payload.amountTtc,
              amountHtCents: commission.amountHtCents,
              amountVatCents: commission.amountVatCents,
              amountTtcCents: commission.amountTtcCents,
              // Stripe cannot split a payment it never sees, so the commission is
              // invoiced and debited separately.
              collectionMethod: 'sepa_direct_debit',
              status: 'pending',
            },
          },
          cesuSettlement: {
            create: {
              medium: payload.medium,
              issuer: payload.medium === 'ecesu' ? (payload.issuer ?? null) : null,
              status: 'declared',
              clientProofRef: payload.clientProofRef ?? null,
            },
          },
        },
        include: CESU_PAYMENT_INCLUDE,
      });

      this.logger.log(
        `CESU payment ${payment.id} declared on booking ${booking.id} (${payload.medium}).`,
      );
      return toCesuPaymentDto(payment);
    } catch (error) {
      // `uq_payments_live_cesu_booking_id` — two simultaneous declarations on one
      // booking would each pass the coverage check above.
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException(
          'A CESU payment is already open on this booking. Wait for the chef to confirm or reject it.',
        );
      }
      throw error;
    }
  }

  /** `GET /me/bookings/:id/payment-status` — what is left to pay, and the chef's NAN. */
  async getBookingPaymentStatus(
    clerkUserId: string,
    bookingId: string,
  ): Promise<BookingPaymentStatusDto> {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, clientId: user.id },
      include: { chefProfile: { include: { sapProfile: true } } },
    });
    if (!booking) {
      throw new NotFoundException('Booking not found.');
    }

    const coverage = await bookingCoverage(this.prisma, booking);
    const sap = booking.chefProfile.sapProfile;
    return {
      ...coverage,
      cesuAvailable: Boolean(sap?.acceptsCesu && sap.crcesuNan),
      crcesuNan: sap?.crcesuNan ?? null,
    };
  }

  /**
   * `GET /chefs/:id/cesu-info` — **public**.
   *
   * The NAN must be readable before any payment exists: without it the client cannot add
   * the chef as an intervenant on their issuer's portal, and invoice A only arrives once
   * the service has been delivered, far too late to be the sole carrier of the number.
   */
  async getChefCesuInfo(chefProfileId: string): Promise<ChefCesuInfoDto> {
    const chef = await this.prisma.chefProfile.findUnique({
      where: { id: chefProfileId },
      select: { ...CHEF_CESU_INFO_SELECT, isActive: true, isVerified: true },
    });
    if (!chef || !chef.isActive || !chef.isVerified) {
      throw new NotFoundException(`Chef profile ${chefProfileId} not found.`);
    }
    return toChefCesuInfo(chef);
  }

  /** `GET /me/chef/cesu-payments`. */
  async listForChef(
    clerkUserId: string,
    status?: CesuSettlementStatus,
  ): Promise<CesuPaymentDto[]> {
    const chef = await this.users.requireOwnChefProfile(clerkUserId);
    const payments = await this.prisma.payment.findMany({
      where: {
        method: 'cesu',
        booking: { chefProfileId: chef.id },
        ...(status ? { cesuSettlement: { status } } : {}),
      },
      include: CESU_PAYMENT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return payments.map(toCesuPaymentDto);
  }

  /** `GET /admin/cesu-payments`. */
  async listForAdmin(status?: CesuSettlementStatus): Promise<CesuPaymentDto[]> {
    const payments = await this.prisma.payment.findMany({
      where: { method: 'cesu', ...(status ? { cesuSettlement: { status } } : {}) },
      include: CESU_PAYMENT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return payments.map(toCesuPaymentDto);
  }

  /**
   * `POST /me/chef/cesu-payments/:id/confirm` — the chef states the funds arrived.
   *
   * This is the only settlement signal that exists. It settles the payment, confirms the
   * booking when the payments now cover it, and makes the commission due, which under the
   * default `on_payment` trigger immediately cuts facture B and starts the SEPA debit.
   */
  async confirm(clerkUserId: string, paymentId: string): Promise<CesuPaymentDto> {
    const chef = await this.users.requireOwnChefProfile(clerkUserId);
    const payment = await this.requireDeclaredCesuPayment(paymentId);
    if (payment.booking.chefProfileId !== chef.id) {
      throw new ForbiddenException('This CESU payment belongs to another chef.');
    }
    return this.settleDeclaration(paymentId, { confirmedByUserId: chef.userId });
  }

  /**
   * `POST /admin/cesu-payments/:id/force-settle`.
   *
   * Writes a tax-credit line in a chef's name without that chef confirming, so the admin
   * identity and the evidence they acted on are both recorded on the settlement.
   */
  async forceSettle(
    adminClerkUserId: string,
    paymentId: string,
    proofRef: string,
  ): Promise<CesuPaymentDto> {
    const admin = await this.users.ensurePersistedFromClerk(adminClerkUserId);
    await this.requireDeclaredCesuPayment(paymentId);
    this.logger.warn(
      `Admin ${admin.id} force-settled CESU payment ${paymentId} (proof: ${proofRef}).`,
    );
    return this.settleDeclaration(paymentId, {
      confirmedByUserId: admin.id,
      adminOverride: true,
      adminProofRef: proofRef,
    });
  }

  /** `POST /me/chef/cesu-payments/:id/reject` — the funds never arrived. */
  async reject(
    clerkUserId: string,
    paymentId: string,
    reason: string,
  ): Promise<CesuPaymentDto> {
    const chef = await this.users.requireOwnChefProfile(clerkUserId);
    const payment = await this.requireDeclaredCesuPayment(paymentId);
    if (payment.booking.chefProfileId !== chef.id) {
      throw new ForbiddenException('This CESU payment belongs to another chef.');
    }

    const rejected = await this.prisma.$transaction(async (tx) => {
      // Same conditional claim as the confirmation: a rejection must not overwrite a
      // settlement that landed a moment earlier.
      const claimed = await tx.cesuSettlement.updateMany({
        where: { paymentId, status: 'declared' },
        data: {
          status: 'rejected',
          rejectionReason: reason,
          confirmedByUserId: chef.userId,
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException('This CESU payment has already been settled.');
      }

      await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'failed', failureReason: reason },
      });
      await tx.commission.updateMany({
        where: { paymentId },
        data: { status: 'failed' },
      });
      return tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
        include: CESU_PAYMENT_INCLUDE,
      });
    });

    this.logger.log(`CESU payment ${paymentId} rejected by the chef.`);
    return toCesuPaymentDto(rejected);
  }

  /**
   * Shared tail of "the chef confirms" and "an admin overrides": settle the payment, then
   * make the commission due.
   *
   * `onCommissionDue` runs **after** the transaction commits, never inside it — it talks
   * to Stripe, and a network call has no business holding a database transaction open.
   * It also never throws back here: the chef already has the client's money, and a
   * failure to collect the platform's own commission must not undo that settlement.
   */
  private async settleDeclaration(
    paymentId: string,
    settlement: {
      confirmedByUserId: string;
      adminOverride?: boolean;
      adminProofRef?: string;
    },
  ): Promise<CesuPaymentDto> {
    const confirmedAt = new Date();
    const { updated, commissionId } = await this.prisma.$transaction(async (tx) => {
      // Conditional on `declared`, and done before anything else settles: a chef
      // double-clicking, or a chef and an admin acting at the same moment, must produce
      // one settlement and one commission — not two tax-credit lines.
      const claimed = await tx.cesuSettlement.updateMany({
        where: { paymentId, status: 'declared' },
        data: {
          status: 'confirmed',
          confirmedAt,
          rejectionReason: null,
          confirmedByUserId: settlement.confirmedByUserId,
          adminOverride: settlement.adminOverride ?? false,
          adminProofRef: settlement.adminProofRef ?? null,
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException('This CESU payment has already been settled.');
      }

      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
        select: { id: true, bookingId: true, amountTtc: true },
      });
      await settlePayment(tx, payment, { paidAt: confirmedAt });
      const commission = await tx.commission.findUnique({
        where: { paymentId },
        select: { id: true },
      });
      return {
        updated: await tx.payment.findUniqueOrThrow({
          where: { id: paymentId },
          include: CESU_PAYMENT_INCLUDE,
        }),
        commissionId: commission?.id ?? null,
      };
    });

    if (commissionId) {
      await this.commissionDebits.onCommissionDue(commissionId);
    }

    this.logger.log(`CESU payment ${paymentId} confirmed.`);
    return toCesuPaymentDto(updated);
  }

  private async requireDeclaredCesuPayment(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: CESU_PAYMENT_INCLUDE,
    });
    if (!payment || payment.method !== 'cesu' || !payment.cesuSettlement) {
      throw new NotFoundException(`CESU payment ${paymentId} not found.`);
    }
    if (payment.cesuSettlement.status !== 'declared') {
      throw new ConflictException(
        `This CESU payment is already ${payment.cesuSettlement.status}.`,
      );
    }
    return payment;
  }
}

type CesuPaymentRow = {
  id: string;
  bookingId: string;
  amountTtc: number;
  currency: string;
  status: CesuPaymentDto['paymentStatus'];
  createdAt: Date;
  cesuSettlement: {
    medium: CesuPaymentDto['medium'];
    issuer: CesuPaymentDto['issuer'];
    status: CesuSettlementStatus;
    clientProofRef: string | null;
    confirmedAt: Date | null;
    rejectionReason: string | null;
    adminOverride: boolean;
  } | null;
  booking: {
    reference: string | null;
    client: { fullName: string | null; email: string } | null;
    chefProfile: { displayName: string } | null;
  };
};

function toCesuPaymentDto(payment: CesuPaymentRow): CesuPaymentDto {
  return {
    paymentId: payment.id,
    bookingId: payment.bookingId,
    bookingReference: payment.booking.reference,
    amountTtc: payment.amountTtc,
    currency: payment.currency,
    paymentStatus: payment.status,
    medium: payment.cesuSettlement!.medium,
    issuer: payment.cesuSettlement!.issuer,
    settlementStatus: payment.cesuSettlement!.status,
    clientProofRef: payment.cesuSettlement!.clientProofRef,
    confirmedAt: payment.cesuSettlement!.confirmedAt,
    rejectionReason: payment.cesuSettlement!.rejectionReason,
    adminOverride: payment.cesuSettlement!.adminOverride,
    clientName: payment.booking.client?.fullName ?? payment.booking.client?.email ?? null,
    chefDisplayName: payment.booking.chefProfile?.displayName ?? null,
    declaredAt: payment.createdAt,
  };
}
