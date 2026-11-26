import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Prisma } from '../../generated/prisma/client';
import { SupabaseService } from '../../integrations/supabase.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import {
  formatInvoiceNumber,
  invoiceLines,
  invoiceNumberPrefix,
  invoiceYear,
} from './domain/payment-invoices.rules';
import type {
  DocumentLinkDto,
  PaymentInvoiceBackfillResultDto,
  PaymentInvoiceDto,
} from './dto/payment-invoice.dto';
import {
  PaymentInvoiceSnapshot,
  renderPaymentInvoicePdf,
} from './payment-invoice-document';
import { legacyInvoicingEnabled, legacyInvoicingOff } from './legacy-invoicing';
import { htOf, SERVICE_VAT_RATE_BPS } from './payouts/net-price';
import { sasIdentity } from './sas-identity';

const METHOD_LABEL: Record<string, string> = {
  cb: 'carte bancaire',
  cesu: 'CESU',
  avance_immediate: 'avance immédiate',
};

/** Read links are short-lived, like the KYC ones: a leaked link dies in minutes. */
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

/**
 * The client's invoice of a payment.
 *
 * - « Prix net » (default): Lab’s Food invoices in its own name, 10 %
 *   VAT, whatever the method (card, CESU, avance immédiate).
 * - Former invoicing (`LEGACY_INVOICING_ENABLED`): facture A, for a card payment, in
 *   the chef's name.
 *
 * Two steps, on purpose:
 * 1. `issue` numbers the invoice and freezes its content, **inside** the transaction that
 *    settles the payment: a payment is never `succeeded` without its invoice.
 * 2. `archive` draws the PDF and stores it in the private invoices bucket, **after** the
 *    transaction. A storage failure is logged, never thrown: the payment is settled
 *    either way, and the next download redraws the file from the frozen snapshot.
 */
@Injectable()
export class PaymentInvoicesService {
  private readonly logger = new Logger(PaymentInvoicesService.name);
  private readonly bucketName: string;
  private readonly template: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabase: SupabaseService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {
    this.bucketName = config.get<string>('supabase.invoicesBucket', 'labsfood-invoices');
    this.template = config.get<string>('payments.paymentInvoicePrefix', 'LF-CUSYY-XXXXX');
  }

  /**
   * Issues and stores the client's invoice of a payment, in its own transaction.
   * Idempotent. For the « prix net » payments settled outside the card webhook (CESU,
   * avance immédiate), when the SAS records the money as received.
   */
  async issueNow(paymentId: string, paidAt: Date): Promise<void> {
    // Facture A only ever covered card payments, issued by the webhook.
    if (legacyInvoicingEnabled(this.config)) return;
    const invoice = await this.prisma.$transaction((tx) =>
      this.issue(tx, paymentId, paidAt),
    );
    await this.archive(invoice.id);
  }

  /**
   * Numbers and freezes the invoice of a payment. Idempotent on `paymentId`. The invoice
   * is dated and numbered the moment it is issued, never backdated: for a late one
   * (`backfill`) the PDF shows today as the issue date and `paidAt` as the payment date.
   * Numbering counts the year's invoices: two concurrent issues may draw the same number,
   * the unique index refuses the second, and its transaction rolls back (with the payment,
   * in the webhook, whose Stripe retry then settles it again with the next number).
   */
  async issue(
    tx: Prisma.TransactionClient,
    paymentId: string,
    paidAt: Date,
  ): Promise<{ id: string; invoiceNumber: string }> {
    const existing = await tx.paymentInvoice.findUnique({
      where: { paymentId },
      select: { id: true, invoiceNumber: true },
    });
    if (existing) return existing;

    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: {
        id: true,
        purpose: true,
        method: true,
        amountTtc: true,
        currency: true,
        booking: {
          select: {
            id: true,
            reference: true,
            startsAt: true,
            amountTtc: true,
            priceCents: true,
            shoppingFeeCents: true,
            extraPersonsCents: true,
            extraMealsCents: true,
            addressLine: true,
            addressPostalCode: true,
            addressCity: true,
            serviceOffer: { select: { name: true } },
            client: { select: { id: true, fullName: true, email: true } },
            chefProfile: {
              select: {
                id: true,
                displayName: true,
                city: true,
                sapDeclarationNumber: true,
              },
            },
          },
        },
      },
    });
    if (payment.purpose !== 'service') {
      // The caller's bug, never the client's: a courses payment has no invoice A.
      throw new Error(
        `Payment ${payment.id} is a ${payment.purpose} payment: never invoiced.`,
      );
    }
    const { booking } = payment;

    // « Prix net »: the SAS sells, in its own name, with VAT. Same numbering series as
    // before (`LF-CUSYY-XXXXX`, decided by MajorD 26/11/2026).
    const sas = !legacyInvoicingEnabled(this.config);
    const template = this.template;
    const issuedAt = new Date();
    const year = invoiceYear(issuedAt);
    const issuedThisYear = await tx.paymentInvoice.count({
      where: { invoiceNumber: { startsWith: invoiceNumberPrefix(template, year) } },
    });
    const invoiceNumber = formatInvoiceNumber(template, year, issuedThisYear + 1);
    const identity = sasIdentity();
    const htCents = htOf(payment.amountTtc, SERVICE_VAT_RATE_BPS);

    const snapshot: PaymentInvoiceSnapshot = {
      invoiceNumber,
      issuedAt: issuedAt.toISOString(),
      paidAt: paidAt.toISOString(),
      currency: payment.currency,
      amountTtcCents: payment.amountTtc,
      lines: invoiceLines(
        {
          offerName: booking.serviceOffer.name,
          amountTtcCents: booking.amountTtc ?? booking.priceCents,
          shoppingFeeCents: booking.shoppingFeeCents,
          extraPersonsCents: booking.extraPersonsCents,
          extraMealsCents: booking.extraMealsCents,
        },
        payment.amountTtc,
      ),
      ...(sas
        ? {
            issuer: 'sas' as const,
            vat: {
              rateBps: SERVICE_VAT_RATE_BPS,
              htCents,
              vatCents: payment.amountTtc - htCents,
            },
            methodLabel: METHOD_LABEL[payment.method] ?? payment.method,
          }
        : {}),
      seller: sas
        ? {
            displayName: identity.name,
            legalName: identity.legalName,
            city: null,
            sapDeclarationNumber: identity.sapDeclarationNumber,
            siren: identity.siren,
            address: identity.address,
          }
        : {
            displayName: booking.chefProfile.displayName,
            city: booking.chefProfile.city,
            sapDeclarationNumber: booking.chefProfile.sapDeclarationNumber,
          },
      client: {
        name: booking.client.fullName ?? booking.client.email,
        email: booking.client.email,
      },
      booking: {
        reference: booking.reference,
        address:
          [
            booking.addressLine,
            [booking.addressPostalCode, booking.addressCity].filter(Boolean).join(' '),
          ]
            .filter(Boolean)
            .join(', ') || null,
        startsAt: booking.startsAt.toISOString(),
      },
    };

    return tx.paymentInvoice.create({
      data: {
        paymentId: payment.id,
        bookingId: booking.id,
        clientId: booking.client.id,
        chefProfileId: booking.chefProfile.id,
        invoiceNumber,
        issuedAt,
        amountTtcCents: payment.amountTtc,
        currency: payment.currency,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
      },
      select: { id: true, invoiceNumber: true },
    });
  }

  /**
   * Catch-up for card payments settled without an invoice: those paid before invoice A
   * existed. Oldest payment first, so the sequence follows the order they came in; each
   * is issued today (see `issue`). One transaction per payment: one that cannot be
   * invoiced is reported and skipped, and a second run picks up whatever is left. A run
   * racing a live settlement may lose a number to the unique index (`P2002`): run again.
   */
  async backfill(dryRun: boolean): Promise<PaymentInvoiceBackfillResultDto> {
    if (!legacyInvoicingEnabled(this.config)) throw legacyInvoicingOff();
    const payments = await this.prisma.payment.findMany({
      // Never a courses payment: the ingredients are not on any invoice (lot 6, LF-0309).
      where: {
        method: 'cb',
        status: 'succeeded',
        purpose: 'service',
        paidAt: { not: null },
        invoice: null,
      },
      orderBy: { paidAt: 'asc' },
      select: { id: true, paidAt: true },
    });
    const result: PaymentInvoiceBackfillResultDto = {
      dryRun,
      pending: payments.length,
      issued: [],
      failed: [],
    };
    if (dryRun) return result;

    for (const payment of payments) {
      try {
        const invoice = await this.prisma.$transaction((tx) =>
          // `paidAt: { not: null }` above.
          this.issue(tx, payment.id, payment.paidAt!),
        );
        await this.archive(invoice.id);
        result.issued.push({
          paymentId: payment.id,
          invoiceNumber: invoice.invoiceNumber,
        });
        this.logger.log({
          event: 'payment_invoice.backfilled',
          paymentId: payment.id,
          invoiceNumber: invoice.invoiceNumber,
        });
      } catch (error) {
        const { response, code } = (error ?? {}) as {
          response?: { code?: string };
          code?: string;
        };
        result.failed.push({
          paymentId: payment.id,
          code: response?.code ?? code ?? 'UNKNOWN',
        });
        this.logger.error({
          event: 'payment_invoice.backfill_failed',
          paymentId: payment.id,
          reason: error instanceof Error ? error.message : 'unknown error',
        });
      }
    }
    return result;
  }

  /** Draws and stores the PDF. Best-effort: see the class comment. */
  async archive(invoiceId: string): Promise<void> {
    try {
      await this.store(invoiceId);
    } catch (error) {
      this.logger.error({
        event: 'payment_invoice.archive_failed',
        invoiceId,
        reason: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }

  /** The caller's invoices, as client or as the chef they were issued for. */
  async listMine(clerkUserId: string, bookingId?: string): Promise<PaymentInvoiceDto[]> {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    const rows = await this.prisma.paymentInvoice.findMany({
      where: { ...this.ownedBy(user.id), ...(bookingId ? { bookingId } : {}) },
      orderBy: { issuedAt: 'desc' },
      select: {
        id: true,
        invoiceNumber: true,
        issuedAt: true,
        amountTtcCents: true,
        currency: true,
        bookingId: true,
        storagePath: true,
        booking: { select: { reference: true } },
        chefProfile: { select: { displayName: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      invoiceNumber: row.invoiceNumber,
      issuedAt: row.issuedAt,
      amountTtcCents: row.amountTtcCents,
      currency: row.currency,
      bookingId: row.bookingId,
      bookingReference: row.booking.reference,
      chefDisplayName: row.chefProfile.displayName,
      pdfReady: row.storagePath !== null,
    }));
  }

  /**
   * A 5-minute link to the PDF. An invoice whose upload failed is drawn and stored now,
   * so the client never waits on a job. Someone else's invoice answers 404, not 403:
   * its existence is not the caller's business.
   */
  async downloadUrl(clerkUserId: string, invoiceId: string): Promise<DocumentLinkDto> {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    const invoice = await this.prisma.paymentInvoice.findFirst({
      where: { id: invoiceId, ...this.ownedBy(user.id) },
      select: { id: true, invoiceNumber: true, storagePath: true },
    });
    if (!invoice) {
      throw new NotFoundException({
        code: 'INVOICE_NOT_FOUND',
        message: 'No invoice with this id for this account.',
      });
    }

    const storagePath = invoice.storagePath ?? (await this.store(invoice.id));
    const { data, error } = await this.bucket().createSignedUrl(
      storagePath,
      DOWNLOAD_URL_TTL_SECONDS,
      { download: `facture-${invoice.invoiceNumber}.pdf` },
    );
    if (error || !data) {
      this.logger.error({
        event: 'payment_invoice.sign_failed',
        invoiceId: invoice.id,
        reason: error?.message ?? 'no data',
      });
      throw unavailable();
    }
    return {
      url: data.signedUrl,
      expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000),
    };
  }

  private ownedBy(userId: string): Prisma.PaymentInvoiceWhereInput {
    return { OR: [{ clientId: userId }, { chefProfile: { userId } }] };
  }

  /**
   * Draws the PDF from the frozen snapshot and writes it. The path is fixed per invoice
   * and the drawing deterministic, so `upsert` makes a retry after a half-done attempt
   * (file written, row not updated) converge instead of failing on "already exists".
   */
  private async store(invoiceId: string): Promise<string> {
    const invoice = await this.prisma.paymentInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: { id: true, clientId: true, invoiceNumber: true, snapshot: true },
    });
    const pdf = await renderPaymentInvoicePdf(
      invoice.snapshot as unknown as PaymentInvoiceSnapshot,
    );
    const storagePath = `clients/${invoice.clientId}/${invoice.invoiceNumber}.pdf`;

    const { error } = await this.bucket().upload(storagePath, pdf, {
      contentType: 'application/pdf',
      upsert: true,
    });
    if (error) {
      this.logger.error({
        event: 'payment_invoice.put_failed',
        invoiceId: invoice.id,
        reason: error.message,
      });
      throw unavailable();
    }

    await this.prisma.paymentInvoice.update({
      where: { id: invoice.id },
      data: { storagePath, archivedAt: new Date() },
    });
    this.logger.log({
      event: 'payment_invoice.archived',
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
    });
    return storagePath;
  }

  private bucket() {
    if (!this.supabase.configured) {
      throw unavailable();
    }
    return this.supabase.getClient().storage.from(this.bucketName);
  }
}

function unavailable() {
  return new ServiceUnavailableException({
    code: 'DOCUMENT_STORAGE_UNAVAILABLE',
    message: 'The invoice could not be stored or read. Try again in a moment.',
  });
}
