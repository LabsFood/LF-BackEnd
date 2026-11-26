import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Prisma } from '../../../generated/prisma/client';
import { SupabaseService } from '../../../integrations/supabase.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { EInvoicingService } from '../../einvoicing/einvoicing.service';
import { eInvoiceFromPayoutStatement } from '../../einvoicing/from-payout-statement';
import { chefLegalIdentity, CHEF_LEGAL_SELECT } from '../../users/chef-legal.views';
import { UsersService } from '../../users/users.service';
import { DEFAULT_CESU_PLATFORM_NAME } from '../cesu-collector';
import {
  renderPayoutStatementPdf,
  type PayoutStatementSnapshot,
} from './payout-statement-document';

const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

/** What an autofacture cannot do without, from the batch cooker's legal identity. */
export type StatementBlocker = 'name' | 'siren' | 'businessAddress' | 'vatFranchise';

const FRANCHISE_MENTION = 'TVA non applicable, article 293 B du CGI';

export const STATEMENT_PREFIX = (year: number) => `LF-AF-${year}-`;

type Tx = Prisma.TransactionClient;

/** The payout rows a statement is drawn from. */
export interface StatementPayout {
  id: string;
  method: 'cb' | 'cesu' | 'avance_immediate';
  receivedAt: Date;
  amountTtcCents: number;
  vatRateBps: number;
  amountVatCents: number;
  amountHtCents: number;
  commissionRateBps: number;
  commissionCents: number;
  cesuFeeBps: number;
  cesuFeeCents: number;
  netCents: number;
  payment: { booking: { reference: string | null } };
}

/**
 * The autofacture (and its relevé de versement) the SAS issues in the batch cooker's
 * name when their payouts are marked paid. Numbered in the transaction that pays, drawn
 * and stored after it: a storage failure is logged and redrawn at the first download,
 * never undoes the payment.
 */
@Injectable()
export class PayoutStatementsService {
  private readonly logger = new Logger(PayoutStatementsService.name);
  private readonly bucketName: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabase: SupabaseService,
    private readonly users: UsersService,
    private readonly einvoicing: EInvoicingService,
    config: ConfigService,
  ) {
    this.bucketName = config.get<string>('supabase.invoicesBucket', 'labsfood-invoices');
  }

  /**
   * Why no autofacture can be issued for this batch cooker yet. Only VAT-exempt
   * micro-entrepreneurs (franchise, art. 293 B) are handled: a VAT-registered one
   * would need VAT on the net price, which nothing computes yet.
   */
  async blockers(chefProfileId: string, db: Pick<Tx, 'chefProfile'> = this.prisma) {
    const row = await db.chefProfile.findUnique({
      where: { id: chefProfileId },
      select: CHEF_LEGAL_SELECT,
    });
    if (!row) throw new NotFoundException('No batch cooker with this id.');
    const out: StatementBlocker[] = [];
    if (!row.legalName?.trim()) out.push('name');
    if (!row.siren?.trim()) out.push('siren');
    if (!row.businessAddress?.trim()) out.push('businessAddress');
    if (row.vatRegime !== 'franchise') out.push('vatFranchise');
    return out;
  }

  /** Inside the paying transaction: numbers the statement and links the payouts to it. */
  async issue(
    tx: Tx,
    input: {
      chefProfileId: string;
      payouts: StatementPayout[];
      paidAt: Date;
      transferReference: string | null;
    },
  ): Promise<{ id: string; number: string }> {
    const row = await tx.chefProfile.findUniqueOrThrow({
      where: { id: input.chefProfileId },
      select: CHEF_LEGAL_SELECT,
    });
    const identity = chefLegalIdentity(row);
    const year = input.paidAt.getUTCFullYear();
    const issuedThisYear = await tx.payoutStatement.count({
      where: { number: { startsWith: STATEMENT_PREFIX(year) } },
    });
    const number = `${STATEMENT_PREFIX(year)}${String(issuedThisYear + 1).padStart(4, '0')}`;
    const netCents = input.payouts.reduce((sum, p) => sum + p.netCents, 0);

    const snapshot: PayoutStatementSnapshot = {
      number,
      issuedAt: input.paidAt.toISOString(),
      paidAt: input.paidAt.toISOString(),
      transferReference: input.transferReference,
      currency: 'EUR',
      netCents,
      seller: {
        name: row.legalName ?? '',
        legalStatus: identity.legalStatus,
        siren: row.siren ?? '',
        address: row.businessAddress ?? '',
        vatMention: FRANCHISE_MENTION,
      },
      buyer: {
        name: process.env.CESU_PLATFORM_NAME?.trim() || DEFAULT_CESU_PLATFORM_NAME,
        siren: process.env.SAS_SIREN?.trim() || null,
        address: process.env.SAS_ADDRESS?.trim() || null,
        sapDeclarationNumber: process.env.SAP_DECLARATION_NUMBER?.trim() || null,
      },
      lines: input.payouts.map((p) => ({
        bookingReference: p.payment.booking.reference,
        method: p.method,
        receivedAt: p.receivedAt.toISOString(),
        amountTtcCents: p.amountTtcCents,
        vatRateBps: p.vatRateBps,
        amountVatCents: p.amountVatCents,
        amountHtCents: p.amountHtCents,
        commissionRateBps: p.commissionRateBps,
        commissionCents: p.commissionCents,
        cesuFeeBps: p.cesuFeeBps,
        cesuFeeCents: p.cesuFeeCents,
        netCents: p.netCents,
      })),
    };

    const statement = await tx.payoutStatement.create({
      data: {
        number,
        chefProfileId: input.chefProfileId,
        issuedAt: input.paidAt,
        netCents,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
      },
      select: { id: true, number: true },
    });
    await tx.chefPayout.updateMany({
      where: { id: { in: input.payouts.map((p) => p.id) } },
      data: { statementId: statement.id },
    });
    return statement;
  }

  /** Draws and stores the PDF. Best-effort: redrawn at the first download otherwise. */
  async archive(statementId: string): Promise<void> {
    try {
      await this.store(statementId);
    } catch (error) {
      this.logger.error({
        event: 'payout_statement.archive_failed',
        statementId,
        reason: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }

  /**
   * Hands the autofacture to the approved e-invoicing platform. Does nothing while
   * `EINVOICING_PROVIDER=none`; best-effort otherwise (the PDF stays the reference).
   */
  async transmit(statementId: string): Promise<void> {
    if (!this.einvoicing.enabled) return;
    try {
      const statement = await this.prisma.payoutStatement.findUniqueOrThrow({
        where: { id: statementId },
        select: { snapshot: true },
      });
      await this.einvoicing.submit(
        eInvoiceFromPayoutStatement(
          statement.snapshot as unknown as PayoutStatementSnapshot,
        ),
      );
    } catch (error) {
      this.logger.error({
        event: 'payout_statement.einvoice_failed',
        statementId,
        reason: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }

  /** The batch cooker's own statements, newest first. */
  async listMine(clerkUserId: string) {
    const chef = await this.users.requireOwnChefProfile(clerkUserId);
    const rows = await this.prisma.payoutStatement.findMany({
      where: { chefProfileId: chef.id },
      orderBy: { issuedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        number: true,
        issuedAt: true,
        netCents: true,
        _count: { select: { payouts: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      issuedAt: r.issuedAt.toISOString(),
      netCents: r.netCents,
      lines: r._count.payouts,
    }));
  }

  async downloadForChef(clerkUserId: string, statementId: string) {
    const chef = await this.users.requireOwnChefProfile(clerkUserId);
    return this.downloadUrl({ id: statementId, chefProfileId: chef.id });
  }

  async downloadForAdmin(statementId: string) {
    return this.downloadUrl({ id: statementId });
  }

  private async downloadUrl(where: Prisma.PayoutStatementWhereInput) {
    const statement = await this.prisma.payoutStatement.findFirst({
      where,
      select: { id: true, number: true, storagePath: true },
    });
    if (!statement) {
      throw new NotFoundException({
        code: 'STATEMENT_NOT_FOUND',
        message: 'No autofacture with this id for this account.',
      });
    }
    const path = statement.storagePath ?? (await this.store(statement.id));
    const { data, error } = await this.bucket().createSignedUrl(
      path,
      DOWNLOAD_URL_TTL_SECONDS,
      {
        download: `autofacture-${statement.number}.pdf`,
      },
    );
    if (error || !data) throw unavailable();
    return {
      url: data.signedUrl,
      expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000),
    };
  }

  private async store(statementId: string): Promise<string> {
    const statement = await this.prisma.payoutStatement.findUniqueOrThrow({
      where: { id: statementId },
      select: { id: true, number: true, chefProfileId: true, snapshot: true },
    });
    const pdf = await renderPayoutStatementPdf(
      statement.snapshot as unknown as PayoutStatementSnapshot,
    );
    const path = `chefs/${statement.chefProfileId}/autofactures/${statement.number}.pdf`;
    const { error } = await this.bucket().upload(path, pdf, {
      contentType: 'application/pdf',
      upsert: true,
    });
    if (error) {
      this.logger.error({
        event: 'payout_statement.put_failed',
        statementId,
        reason: error.message,
      });
      throw unavailable();
    }
    await this.prisma.payoutStatement.update({
      where: { id: statement.id },
      data: { storagePath: path, archivedAt: new Date() },
    });
    return path;
  }

  private bucket() {
    if (!this.supabase.configured) throw unavailable();
    return this.supabase.getClient().storage.from(this.bucketName);
  }
}

function unavailable() {
  return new ServiceUnavailableException({
    code: 'DOCUMENT_STORAGE_UNAVAILABLE',
    message: 'The autofacture could not be stored or read. Try again in a moment.',
  });
}
