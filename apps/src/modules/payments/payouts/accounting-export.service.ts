import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../prisma/prisma.service';
import type { PaymentInvoiceSnapshot } from '../payment-invoice-document';
import type { PayoutStatementSnapshot } from './payout-statement-document';

/*
 * TEMPORAIRE — à retirer au passage à B2Brouter (au plus tard le 1er septembre 2027).
 *
 * Décision MajorD du 26/11/2026 : en attendant l'obligation d'émettre par une
 * plateforme agréée, Indy (gratuit, sans API) tient la comptabilité. Cet export donne
 * à l'admin, pour une période, les factures de vente de Lab’s Food (au foyer, TVA
 * 10 %) et ses achats aux batch cookers (autofactures), à reporter dans Indy. Quand
 * B2Brouter émet et reçoit par API, il transmet lui-même ces pièces : on supprime
 * alors ce fichier, sa route `admin/payouts/accounting` et le bouton de la console.
 */

export interface AccountingLine {
  /** `vente`: Lab’s Food invoices the household. `achat`: autofacture to a batch cooker. */
  kind: 'vente' | 'achat';
  number: string;
  issuedAt: string;
  /** Client (vente) or batch cooker (achat). */
  counterparty: string;
  /** « carte bancaire », « CESU », « avance immédiate »; null for an autofacture. */
  method: string | null;
  htCents: number;
  vatRateBps: number;
  vatCents: number;
  ttcCents: number;
}

export interface AccountingPeriod {
  from?: Date;
  to?: Date;
}

const MAX_ROWS = 5000;

@Injectable()
export class AccountingExportService {
  constructor(private readonly prisma: PrismaService) {}

  /** Sales then purchases of the period, each by issue date. Former facture A excluded. */
  async lines(period: AccountingPeriod): Promise<AccountingLine[]> {
    const issuedAt = {
      ...(period.from ? { gte: period.from } : {}),
      ...(period.to ? { lt: period.to } : {}),
    };
    const [invoices, statements] = await Promise.all([
      this.prisma.paymentInvoice.findMany({
        // Facture A was the batch cooker's sale, not Lab’s Food's: never in its books.
        where: { issuedAt, snapshot: { path: ['issuer'], equals: 'sas' } },
        orderBy: { issuedAt: 'asc' },
        take: MAX_ROWS,
        select: { snapshot: true },
      }),
      this.prisma.payoutStatement.findMany({
        where: { issuedAt },
        orderBy: { issuedAt: 'asc' },
        take: MAX_ROWS,
        select: { snapshot: true },
      }),
    ]);
    return [
      ...invoices.map((i) => saleLine(i.snapshot as unknown as PaymentInvoiceSnapshot)),
      ...statements.map((s) =>
        purchaseLine(s.snapshot as unknown as PayoutStatementSnapshot),
      ),
    ];
  }
}

function saleLine(s: PaymentInvoiceSnapshot): AccountingLine {
  const vat = s.vat ?? { rateBps: 0, htCents: s.amountTtcCents, vatCents: 0 };
  return {
    kind: 'vente',
    number: s.invoiceNumber,
    issuedAt: s.issuedAt,
    counterparty: s.client.name,
    method: s.methodLabel ?? null,
    htCents: vat.htCents,
    vatRateBps: vat.rateBps,
    vatCents: vat.vatCents,
    ttcCents: s.amountTtcCents,
  };
}

/** The batch cooker is in VAT franchise (293 B): the net is HT and TTC alike. */
function purchaseLine(s: PayoutStatementSnapshot): AccountingLine {
  return {
    kind: 'achat',
    number: s.number,
    issuedAt: s.issuedAt,
    counterparty: s.seller.name,
    method: null,
    htCents: s.netCents,
    vatRateBps: 0,
    vatCents: 0,
    ttcCents: s.netCents,
  };
}
