import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { CesuSettlementStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { cesuCollector } from './cesu-collector';
import { KycStorageService } from '../chef-onboarding/services/kyc-storage.service';
import { UsersService } from '../users/users.service';
import {
  CHEF_CESU_INFO_SELECT,
  OFFERED_METHODS_SELECT,
  cesuAccepted,
  offeredMethods,
  toChefCesuInfo,
} from './chef-cesu-info';
import { CommissionDebitsService } from './commission-debits.service';
import { assertNoCommissionBlock } from './commission-standing';
import { commissionForPayment } from './commission-policy';
import {
  BookingPaymentStatusDto,
  CesuPaymentDto,
  CesuProofUploadDto,
  ChefCesuInfoDto,
  DeclareCesuPaymentDto,
} from './dto/cesu.dto';
import { assertPayable, commissionBlockApplies, CONTRACT_SELECT } from './payment-rules';
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
 * Where a client's e-CESU proof lives, in the private bucket. Keyed on the booking:
 * the file is uploaded before the payment it proves exists.
 */
const proofPrefix = (bookingId: string) => `cesu-proofs/${bookingId}`;
const PROOF = 'proof';

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
    private readonly proofs: KycStorageService,
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
      include: {
        chefProfile: {
          include: { sapProfile: true, sepaMandate: { select: { status: true } } },
        },
        serviceOffer: CONTRACT_SELECT.serviceOffer,
      },
    });
    if (!booking) {
      throw new NotFoundException('Booking not found.');
    }
    assertPayable(booking);

    const chef = booking.chefProfile;
    // Re-checked here, not only at booking time: vetting can be revoked in between, and
    // this is what puts a chef's NAN in front of a paying client.
    // Being offline does not excuse a client from paying a prestation already done.
    if (!chef.isVerified || (commissionBlockApplies(booking) && !chef.isActive)) {
      throw new ConflictException(
        'The chef is not verified by an admin, so this booking cannot be paid.',
      );
    }
    // The commission on a CESU payment is debited from the chef afterwards, so no
    // mandate means no CESU: the opt-in and the NAN alone are not enough.
    if (!cesuAccepted(chef.sapProfile, chef.sepaMandate)) {
      throw new ConflictException({
        code: 'CESU_NOT_ACCEPTED',
        message:
          'This chef does not accept prefinanced CESU (no opt-in, no CRCESU affiliation ' +
          'number, or no active commission mandate).',
      });
    }
    // §6 guard: an uncollectable commission stops the chef taking on new work.
    if (commissionBlockApplies(booking)) {
      await assertNoCommissionBlock(
        this.prisma,
        chef.id,
        this.commissionDebits.maxAttempts,
      );
    }

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

    // Required for e-CESU by the DTO: the issuer's confirmation, Lab's Food's evidence
    // in a dispute. It settles nothing: the chef still confirms receipt.
    const proofPath = payload.proofUploadId
      ? await this.checkedProof(booking.id, payload.proofUploadId)
      : null;

    const commission = await commissionForPayment(
      this.prisma,
      booking,
      payload.amountTtc,
      {
        rateBps: this.config.get<number>('payments.commissionRateBps', 1500),
        vatRateBps: this.config.get<number>('payments.commissionVatRateBps', 2000),
      },
    );

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
              clientProofPath: proofPath,
              clientProofUploadedAt: proofPath ? new Date() : null,
            },
          },
        },
        include: CESU_PAYMENT_INCLUDE,
      });

      this.logger.log({
        event: 'cesu.declared',
        paymentId: payment.id,
        bookingId: booking.id,
        medium: payload.medium,
        withProof: proofPath !== null,
      });
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

  /**
   * `POST /me/bookings/:id/cesu-proof/upload-url` — step 1 of an e-CESU declaration:
   * the issuer's confirmation goes straight to the private bucket.
   */
  async proofUploadUrl(
    clerkUserId: string,
    bookingId: string,
    payload: CesuProofUploadDto,
  ) {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, clientId: user.id },
      select: { id: true, status: true, endsAt: true, ...CONTRACT_SELECT },
    });
    if (!booking) {
      throw new NotFoundException({
        code: 'BOOKING_NOT_FOUND',
        message: 'Booking not found.',
      });
    }
    assertPayable(booking);
    const upload = await this.proofs.createUploadUrl(
      proofPrefix(booking.id),
      PROOF,
      payload.contentType,
      payload.sizeBytes,
    );
    return {
      uploadId: upload.uploadId,
      method: upload.method,
      url: upload.url,
      headers: upload.headers,
      expiresAt: upload.expiresAt,
    };
  }

  /**
   * `PUT /me/cesu-payments/:id/proof` — a wrong file replaced, while the chef has not
   * answered. After that the proof is evidence, and stays as it is.
   */
  async replaceProof(
    clerkUserId: string,
    paymentId: string,
    uploadId: string,
  ): Promise<CesuPaymentDto> {
    const payment = await this.clientsCesuPayment(clerkUserId, paymentId);
    const path = await this.checkedProof(payment.bookingId, uploadId);
    const { count } = await this.prisma.cesuSettlement.updateMany({
      where: { paymentId, status: 'declared' },
      data: { clientProofPath: path, clientProofUploadedAt: new Date() },
    });
    if (count === 0) {
      throw new ConflictException({
        code: 'PROOF_LOCKED',
        message: 'The chef has answered this payment: its proof is kept as it is.',
      });
    }
    this.logger.log({
      event: 'cesu.proof_replaced',
      paymentId,
      bookingId: payment.bookingId,
    });
    const previous = payment.cesuSettlement.clientProofPath;
    if (previous && previous !== path) await this.proofs.removeObjects([previous]);
    return toCesuPaymentDto(
      await this.prisma.payment.findUniqueOrThrow({
        where: { id: paymentId },
        include: CESU_PAYMENT_INCLUDE,
      }),
    );
  }

  /** `GET /me/cesu-payments/:id/proof-url` — the client's own proof, 5 minutes. */
  async proofUrl(clerkUserId: string, paymentId: string) {
    return this.proofLink(await this.clientsCesuPayment(clerkUserId, paymentId));
  }

  /** `GET /admin/cesu-payments/:id/proof-url` — for a dispute. */
  async adminProofUrl(paymentId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, method: 'cesu' },
      include: { cesuSettlement: true },
    });
    if (!payment?.cesuSettlement) {
      throw new NotFoundException(`CESU payment ${paymentId} not found.`);
    }
    return this.proofLink(payment);
  }

  /** `GET /me/bookings/:id/payment-status` — what is left to pay, and the chef's NAN. */
  async getBookingPaymentStatus(
    clerkUserId: string,
    bookingId: string,
  ): Promise<BookingPaymentStatusDto> {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, clientId: user.id },
      include: {
        chefProfile: {
          include: { sapProfile: true, sepaMandate: { select: { status: true } } },
        },
      },
    });
    if (!booking) {
      throw new NotFoundException('Booking not found.');
    }

    const coverage = await bookingCoverage(this.prisma, booking);
    const sap = booking.chefProfile.sapProfile;
    return {
      ...coverage,
      cesuAvailable: cesuAccepted(sap, booking.chefProfile.sepaMandate),
      payeeNan: cesuCollector()?.nan ?? null,
      payeeName: cesuCollector()?.name ?? null,
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

  /**
   * `GET /chefs/{id}/payment-methods` (CGV V1 5.1): what the booking screen offers. The
   * card is the one every booking saves, so without it nothing can be booked.
   */
  async getChefPaymentMethods(chefProfileId: string) {
    const chef = await this.prisma.chefProfile.findUnique({
      where: { id: chefProfileId },
      select: { ...OFFERED_METHODS_SELECT, isActive: true, isVerified: true },
    });
    if (!chef || !chef.isActive || !chef.isVerified) {
      throw new NotFoundException(`Chef profile ${chefProfileId} not found.`);
    }
    const offered = offeredMethods(
      chef,
      this.config.get<string>('urssaf.gateway', 'disabled'),
    );
    return { card: offered.cb, urssaf: offered.avance_immediate, cesu: offered.cesu };
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
        purpose: 'service',
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
      where: {
        method: 'cesu',
        purpose: 'service',
        ...(status ? { cesuSettlement: { status } } : {}),
      },
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
    // The proof reference is the admin's free text: it stays in the database.
    this.logger.warn({ event: 'cesu.force_settled', paymentId, adminUserId: admin.id });
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

    this.logger.log({ event: 'cesu.rejected', paymentId });
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

    this.logger.log({ event: 'cesu.confirmed', paymentId, commissionId });
    return toCesuPaymentDto(updated);
  }

  private async clientsCesuPayment(clerkUserId: string, paymentId: string) {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, method: 'cesu', booking: { clientId: user.id } },
      include: { cesuSettlement: true },
    });
    if (!payment?.cesuSettlement) {
      throw new NotFoundException(`CESU payment ${paymentId} not found.`);
    }
    return { ...payment, cesuSettlement: payment.cesuSettlement };
  }

  private proofLink(payment: {
    cesuSettlement: { clientProofPath: string | null } | null;
  }) {
    const path = payment.cesuSettlement?.clientProofPath;
    if (!path) {
      throw new NotFoundException({
        code: 'NO_PROOF',
        message: 'No proof was uploaded for this payment.',
      });
    }
    return this.proofs.createDownloadUrl(path);
  }

  /** The uploaded proof: really there, and of a type and size a proof may be. */
  private async checkedProof(bookingId: string, uploadId: string): Promise<string> {
    const path = this.proofs.buildPath(proofPrefix(bookingId), PROOF, uploadId);
    let stat: { sizeBytes: number; mimeType: string };
    try {
      stat = await this.proofs.statObject(path);
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
      throw new UnprocessableEntityException({
        code: 'PROOF_MISSING',
        message: 'No file was uploaded for this proof. Upload it, then declare.',
      });
    }
    this.proofs.assertAcceptable(stat.mimeType, stat.sizeBytes);
    return path;
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
    clientProofUploadedAt?: Date | null;
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
    proofUploadedAt: payment.cesuSettlement!.clientProofUploadedAt ?? null,
    confirmedAt: payment.cesuSettlement!.confirmedAt,
    rejectionReason: payment.cesuSettlement!.rejectionReason,
    adminOverride: payment.cesuSettlement!.adminOverride,
    clientName: payment.booking.client?.fullName ?? payment.booking.client?.email ?? null,
    chefDisplayName: payment.booking.chefProfile?.displayName ?? null,
    declaredAt: payment.createdAt,
  };
}
