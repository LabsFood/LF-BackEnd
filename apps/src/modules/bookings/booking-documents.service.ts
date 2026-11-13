import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SentryCron } from '@sentry/nestjs';

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
      items: {
        where: { removed: false },
        orderBy: [{ aisle: 'asc' }, { name: 'asc' }],
        select: { name: true, quantity: true },
      },
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
        if (doc.kind === 'debours-mandate') continue;
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

  private render(kind: BookingDocumentKind, booking: ContractRow): Promise<Buffer> {
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
    return documents.renderDeboursMandatePdf({
      reference: booking.reference ?? booking.id,
      clientName: booking.client.fullName ?? booking.client.email,
      chefName: chefNameOf(booking),
      chefSiren: booking.chefProfile.siren,
      startsAt: booking.startsAt,
      address: addressOf(booking),
      meals: booking.bookingMeals.map((line) => line.meal.name),
      shopping: (booking.shoppingList?.items ?? []).map(
        (item) => `${item.name} — ${item.quantity}`,
      ),
      acceptedAt: booking.deboursMandateAcceptedAt!,
      version: booking.contractVersion ?? '1.0',
    });
  }
}
