import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SentryCron } from '@sentry/nestjs';
import { aislesInForce } from '../platform-settings/recipe-lists';
import { groupByAisle } from '../dishes/domain/recipes.rules';
import { formatQuantity, linesOf } from '../shopping-lists/shopping-lists.service';

import { AuditService } from '../../common/audit/audit.service';
import { stackOf } from '../../common/logging/app-logger';
import { DAY_MS } from '../../common/paris-time';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { coveredAmount } from '../payments/payment-settlement';
import {
  CHEF_LEGAL_SELECT,
  legalIdentityLines,
  publicChefLegalIdentity,
} from '../users/chef-legal.views';
import { UsersService } from '../users/users.service';
import { BookingWithdrawalsService } from './booking-withdrawals.service';
import { BookingsMailer, type MailFile } from './bookings.mailer';
import { bookingDocuments, type BookingDocumentKind } from './bookings.views';
import * as documents from './contract-documents';
import { withdrawalDeadline } from './domain/withdrawal.rules';

/** A contract or an acknowledgement not sent within a week is left to support. */
const RETRY_WINDOW_MS = 7 * DAY_MS;
/** Bookings handled per run: each sends an email with two PDFs. */
const BATCH = 20;

const CONTRACT_SELECT = {
  id: true,
  reference: true,
  status: true,
  startsAt: true,
  timeSlot: true,
  persons: true,
  addressLine: true,
  addressCity: true,
  addressPostalCode: true,
  priceCents: true,
  amountTtc: true,
  createdAt: true,
  concludedAt: true,
  contractVersion: true,
  deboursMandateAcceptedAt: true,
  earlyExecutionRequestedAt: true,
  withdrawnAt: true,
  withdrawalDueCents: true,
  client: { select: { email: true, fullName: true } },
  chefProfile: { select: { displayName: true, ...CHEF_LEGAL_SELECT } },
  serviceOffer: { select: { name: true } },
  formule: { select: { name: true } },
  quote: {
    select: {
      title: true,
      offers: { where: { status: 'accepted' }, take: 1, select: { conditions: true } },
    },
  },
  bookingMeals: { select: { meal: { select: { name: true } } } },
  shoppingList: {
    select: {
      // Every row: the corrections apply over the computed lines (`linesOf`).
      items: { orderBy: [{ aisle: 'asc' }, { name: 'asc' }] },
    },
  },
  // Recettes lot 6: the Budget and the hold on the mandate, the relevé de débours.
  groceryRun: {
    select: {
      budgetCents: true,
      mandateVersion: true,
      cardBrand: true,
      cardLast4: true,
      holdPlacedAt: true,
      holdExpiresAt: true,
      receiptsSubmittedAt: true,
      capturedCents: true,
      capturedAt: true,
      receipts: {
        select: { id: true, purchasedAt: true },
        orderBy: { purchasedAt: 'asc' },
      },
      lines: { orderBy: { createdAt: 'asc' } },
    },
  },
} satisfies Prisma.BookingSelect;

type ContractRow = Prisma.BookingGetPayload<{ select: typeof CONTRACT_SELECT }>;

const addressOf = (b: ContractRow) =>
  [b.addressLine, [b.addressPostalCode, b.addressCity].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ') || null;

const chefNameOf = (b: ContractRow) =>
  b.chefProfile.legalName ?? b.chefProfile.displayName;

/**
 * The contract on a durable medium (CGV art. 2.4, 5.2): its documents, downloadable
 * from the client's space, and the email that carries them once it is concluded.
 */
@Injectable()
export class BookingDocumentsService {
  private readonly logger = new Logger(BookingDocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly mailer: BookingsMailer,
    private readonly withdrawals: BookingWithdrawalsService,
    private readonly audit: AuditService,
  ) {}

  /** `GET /me/bookings/{id}/documents/{kind}`: one of the booking's documents. */
  async file(clerkUserId: string, id: string, kind: BookingDocumentKind) {
    const client = await this.users.ensurePersistedFromClerk(clerkUserId);
    const booking = await this.prisma.booking.findFirst({
      where: { id, clientId: client.id },
      select: CONTRACT_SELECT,
    });
    if (!booking) {
      throw new NotFoundException({
        code: 'BOOKING_NOT_FOUND',
        message: 'Booking not found.',
      });
    }
    const listed = bookingDocuments(booking).find((doc) => doc.kind === kind);
    if (!listed) {
      throw new NotFoundException({
        code: 'DOCUMENT_NOT_FOUND',
        message: 'This booking has no such document.',
      });
    }
    return { filename: listed.filename, bytes: await this.render(kind, booking) };
  }

  /**
   * Sends the contract of each booking concluded under the CGV V1, once: claimed,
   * then given back if the email did not go. Also retries the withdrawal
   * acknowledgements that did not go at the time.
   */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'bookings-contract-mail' })
  @SentryCron('bookings-contract-mail', {
    checkinMargin: 5,
    maxRuntime: 5,
    failureIssueThreshold: 3,
  })
  async sendContracts(
    now: Date = new Date(),
  ): Promise<{ sent: number; acknowledged: number }> {
    const started = Date.now();
    const since = new Date(now.getTime() - RETRY_WINDOW_MS);
    try {
      const due = await this.prisma.booking.findMany({
        where: {
          contractVersion: { not: null },
          concludedAt: { not: null, gte: since },
          contractMailSentAt: null,
          withdrawnAt: null,
        },
        select: CONTRACT_SELECT,
        orderBy: { concludedAt: 'asc' },
        take: BATCH,
      });
      let sent = 0;
      for (const booking of due) {
        if (await this.sendContract(booking, now)) sent += 1;
      }

      const unacknowledged = await this.prisma.booking.findMany({
        where: { withdrawnAt: { gte: since }, withdrawalAckSentAt: null },
        select: CONTRACT_SELECT,
        take: BATCH,
      });
      let acknowledged = 0;
      for (const booking of unacknowledged) {
        const due = booking.withdrawalDueCents;
        const paid = await coveredAmount(this.prisma, booking.id);
        const ok = await this.withdrawals.acknowledge(booking, booking.withdrawnAt!, {
          dueCents: due,
          refundCents: due === null ? null : Math.max(0, paid - due),
        });
        if (ok) acknowledged += 1;
      }

      this.logger.log({
        event: 'job.contract_mail',
        sent,
        acknowledged,
        pending: due.length - sent,
        ms: Date.now() - started,
      });
      return { sent, acknowledged };
    } catch (error) {
      this.logger.error({ event: 'job.contract_mail_failed' }, stackOf(error));
      return { sent: 0, acknowledged: 0 };
    }
  }

  private async sendContract(booking: ContractRow, now: Date): Promise<boolean> {
    const claimed = await this.prisma.booking.updateMany({
      where: { id: booking.id, contractMailSentAt: null },
      data: { contractMailSentAt: now },
    });
    if (claimed.count !== 1) return false;

    try {
      const files: MailFile[] = [];
      for (const doc of bookingDocuments(booking)) {
        // The mandate is the client's to download: its CGV are in the CGV (annexe 3).
        if (doc.kind === 'debours-mandate' || doc.kind === 'groceries-statement')
          continue;
        files.push({ name: doc.filename, bytes: await this.render(doc.kind, booking) });
      }
      const { sent } = await this.mailer.contractClient({
        bookingId: booking.id,
        reference: booking.reference,
        client: booking.client,
        title: booking.quote?.title ?? booking.formule?.name ?? booking.serviceOffer.name,
        startsAt: booking.startsAt,
        slot: booking.timeSlot,
        address: addressOf(booking),
        persons: booking.persons,
        priceCents: booking.amountTtc ?? booking.priceCents,
        conditions: booking.quote?.offers[0]?.conditions ?? null,
        chefName: chefNameOf(booking),
        chefIdentity: legalIdentityLines(
          publicChefLegalIdentity(booking.chefProfile),
          booking.chefProfile.displayName,
        ).join('\n'),
        withdrawalUntil: withdrawalDeadline(booking.concludedAt!),
        earlyExecution: booking.earlyExecutionRequestedAt !== null,
        files,
      });
      if (!sent) throw new Error('Brevo did not send the contract email.');
    } catch (error) {
      this.logger.error(
        { event: 'booking.contract_mail_failed', bookingId: booking.id },
        stackOf(error),
      );
      await this.prisma.booking.update({
        where: { id: booking.id },
        data: { contractMailSentAt: null },
      });
      return false;
    }

    this.logger.log({ event: 'booking.contract_mail_sent', bookingId: booking.id });
    await this.audit.record({
      actorType: 'system',
      action: 'booking.contract_sent',
      subjectType: 'booking',
      subjectId: booking.id,
      metadata: { version: booking.contractVersion },
    });
    return true;
  }

  /**
   * The list as the chef left it, grouped by aisle in store order (decision of
   * 16/11), each aisle under its label; a line every recipe marks optional says so.
   */
  private async shoppingByAisle(booking: ContractRow) {
    const items = booking.shoppingList?.items ?? [];
    if (!items.length) return [];
    const aisles = await aislesInForce(this.prisma);
    const labelOf = (code: string) =>
      aisles.find((aisle) => aisle.code === code)?.label ??
      (code === 'autre' ? 'Autre' : code);
    return groupByAisle(
      linesOf(items),
      aisles.map((aisle) => aisle.code),
    ).map((group) => ({
      aisle: labelOf(group.aisle),
      lines: group.lines.map(
        (line) =>
          `${line.name} — ${formatQuantity(line)}${line.optional ? ' (facultatif)' : ''}`,
      ),
    }));
  }

  /**
   * Recettes lot 6: the mandate PDF of a booking as it reads now, for the proof of
   * acceptance (its SHA-256 is kept on the grocery run).
   */
  async mandatePdf(bookingId: string): Promise<Buffer | null> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: CONTRACT_SELECT,
    });
    if (!booking?.deboursMandateAcceptedAt) return null;
    return this.render('debours-mandate', booking);
  }

  /** Recettes lot 6 (CGV 7.6): the relevé de débours, with its receipts. */
  private groceriesStatement(booking: ContractRow): Promise<Buffer> {
    const run = booking.groceryRun!;
    return documents.renderGroceriesStatementPdf({
      reference: booking.reference ?? booking.id,
      clientName: booking.client.fullName ?? booking.client.email,
      chefName: chefNameOf(booking),
      startsAt: booking.startsAt,
      budgetCents: run.budgetCents,
      receipts: run.receipts,
      lines: run.lines.map((line) => ({
        label: line.label,
        amountCents: line.amountCents,
        withReceipt: line.receiptId !== null,
        approved: line.clientApprovedAt !== null,
        contested: line.contestedAt !== null,
        decision: line.decision,
        refundedCents: line.refundedCents,
      })),
      capturedCents: run.capturedCents,
      capturedAt: run.capturedAt,
      refundedCents: run.lines.reduce((sum, line) => sum + line.refundedCents, 0),
    });
  }

  private async render(kind: BookingDocumentKind, booking: ContractRow): Promise<Buffer> {
    if (kind === 'cgv') return documents.cgvPdf(booking.contractVersion!);
    if (kind === 'withdrawal-form') {
      return documents.renderWithdrawalFormPdf({
        reference: booking.reference ?? booking.id,
        chefName: chefNameOf(booking),
        bookedOn: booking.createdAt,
        clientName: booking.client.fullName ?? booking.client.email,
        clientAddress: addressOf(booking),
      });
    }
    if (kind === 'groceries-statement') return this.groceriesStatement(booking);
    const shopping = await this.shoppingByAisle(booking);
    const run = booking.groceryRun;
    return documents.renderDeboursMandatePdf({
      reference: booking.reference ?? booking.id,
      clientName: booking.client.fullName ?? booking.client.email,
      chefName: chefNameOf(booking),
      chefSiren: booking.chefProfile.siren,
      startsAt: booking.startsAt,
      address: addressOf(booking),
      meals: booking.bookingMeals.map((line) => line.meal.name),
      shopping,
      acceptedAt: booking.deboursMandateAcceptedAt!,
      version: booking.contractVersion ?? '1.0',
      groceries: run
        ? {
            budgetCents: run.budgetCents,
            mandateVersion: run.mandateVersion,
            card: run.cardLast4
              ? `${run.cardBrand ?? 'carte'} ···· ${run.cardLast4}`
              : null,
            holdPlacedAt: run.holdPlacedAt,
            holdExpiresAt: run.holdExpiresAt,
          }
        : null,
    });
  }
}
