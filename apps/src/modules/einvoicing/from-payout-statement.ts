import type { PayoutStatementSnapshot } from '../payments/payouts/payout-statement-document';
import type { EInvoice } from './einvoice';

const METHOD_LABEL = {
  cb: 'carte',
  cesu: 'CESU',
  avance_immediate: 'avance immédiate',
} as const;

/**
 * The autofacture (self-billed invoice) as an e-invoice: the batch cooker sells, the
 * SAS buys, one line per payment at the net price, no VAT (franchise en base).
 */
export function eInvoiceFromPayoutStatement(s: PayoutStatementSnapshot): EInvoice {
  return {
    kind: 'self_billed',
    number: s.number,
    issueDate: s.issuedAt,
    currency: s.currency,
    seller: { name: s.seller.name, siren: s.seller.siren, address: s.seller.address },
    buyer: { name: s.buyer.name, siren: s.buyer.siren, address: s.buyer.address },
    lines: s.lines.map((line) => ({
      description: `Prestation de batch cooking${
        line.bookingReference ? ` ${line.bookingReference}` : ''
      } (payée en ${METHOD_LABEL[line.method]} le ${line.receivedAt.slice(0, 10)})`,
      quantity: 1,
      unitPriceHtCents: line.netCents,
      vatRateBps: 0,
    })),
    vatExemptionReason: s.seller.vatMention,
    notes: [
      'Autofacturation : facture émise par le client au nom et pour le compte du prestataire (art. 289 I-2 du CGI).',
      ...(s.buyer.sapDeclarationNumber
        ? [`Déclaration SAP ${s.buyer.sapDeclarationNumber}`]
        : []),
    ],
  };
}
