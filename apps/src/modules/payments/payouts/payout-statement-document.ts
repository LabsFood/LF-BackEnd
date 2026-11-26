import {
  brandDocument,
  brandHeader,
  COLOR,
  FONT,
  footer,
  label,
  PAGE,
  panel,
  rule,
  section,
  TEXT,
  toBuffer,
} from '../../../common/pdf/brand';
import { formatMoney } from '../payment-invoice-document';

/**
 * Autofacture et relevé de versement (« prix net », 25/11/2026): the batch cooker's
 * invoice to Labs Food Batchcooking SAS for the net price, issued by the SAS in their
 * name (autofacturation, art. 289 I-2 du CGI), followed by the statement of how each
 * net price was reached from what the household paid.
 *
 * Everything comes from the snapshot frozen when the payouts were marked paid.
 */

export interface PayoutStatementLine {
  bookingReference: string | null;
  method: 'cb' | 'cesu' | 'avance_immediate';
  receivedAt: string;
  amountTtcCents: number;
  vatRateBps: number;
  amountVatCents: number;
  amountHtCents: number;
  commissionRateBps: number;
  commissionCents: number;
  cesuFeeBps: number;
  cesuFeeCents: number;
  netCents: number;
}

export interface PayoutStatementSnapshot {
  number: string;
  issuedAt: string;
  paidAt: string;
  transferReference: string | null;
  currency: string;
  netCents: number;
  seller: {
    name: string;
    legalStatus: string | null;
    siren: string;
    address: string;
    /** « TVA non applicable, article 293 B du CGI ». */
    vatMention: string;
  };
  buyer: {
    name: string;
    siren: string | null;
    address: string | null;
    sapDeclarationNumber: string | null;
  };
  lines: PayoutStatementLine[];
}

const METHOD: Record<PayoutStatementLine['method'], string> = {
  cb: 'Carte',
  cesu: 'CESU',
  avance_immediate: 'Avance immédiate',
};

const parisDay = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', {
    timeZone: 'Europe/Paris',
    dateStyle: 'long',
  });

const shortDay = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });

const rate = (bps: number) =>
  `${(bps / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;

export function renderPayoutStatementPdf(s: PayoutStatementSnapshot): Promise<Buffer> {
  const doc = brandDocument({
    Title: `Autofacture ${s.number}`,
    Author: s.buyer.name,
    Subject: `Autofacture et relevé de versement pour ${s.seller.name}`,
  });
  const done = toBuffer(doc);
  const money = (cents: number) => formatMoney(cents, s.currency);

  brandHeader(doc, 'Autofacture', s.number);
  doc.y = 122;
  label(doc, `Émise le ${parisDay(s.issuedAt)}`, COLOR.terra);
  doc.y += 6;
  doc
    .font(FONT.display)
    .fontSize(22)
    .fillColor(COLOR.navy)
    .text('Autofacture', PAGE.left, doc.y, TEXT);
  doc.y += 2;
  doc
    .font(FONT.text)
    .fontSize(10)
    .fillColor(COLOR.inkMid)
    .text(
      `Prestations de préparation de repas sous-traitées · réglée par virement le ${parisDay(s.paidAt)}`,
      TEXT,
    );

  doc.y += 16;
  panel(doc, COLOR.cream, COLOR.inkSoft, [
    {
      label: 'Prestataire',
      value: [
        s.seller.name,
        s.seller.legalStatus,
        `SIREN ${s.seller.siren}`,
        s.seller.address,
        s.seller.vatMention,
      ]
        .filter(Boolean)
        .join('\n'),
      strong: true,
    },
    {
      label: 'Client',
      value: [
        s.buyer.name,
        s.buyer.siren ? `SIREN ${s.buyer.siren}` : null,
        s.buyer.address,
        s.buyer.sapDeclarationNumber
          ? `Déclaration SAP n° ${s.buyer.sapDeclarationNumber}`
          : null,
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ]);

  doc.y += 18;
  label(doc, 'Prestations facturées', COLOR.terra);
  doc.y += 6;
  panel(doc, COLOR.cream, COLOR.inkSoft, [
    ...s.lines.map((l) => ({
      label: l.bookingReference ? `Réservation ${l.bookingReference}` : 'Réservation',
      value: `Préparation de repas à domicile · ${money(l.netCents)}`,
    })),
    { label: 'Total HT', value: money(s.netCents) },
    { label: 'TVA', value: s.seller.vatMention },
    { label: 'Total à payer', value: money(s.netCents), strong: true },
  ]);

  section(
    doc,
    'Mentions',
    `Autofacturation : facture établie par ${s.buyer.name} au nom et pour le compte de ` +
      `${s.seller.name}, en vertu de leur contrat de sous-traitance (art. 289 I-2 du CGI). ` +
      `Payée par virement${s.transferReference ? ` (libellé « ${s.transferReference} »)` : ''}.`,
  );

  // The statement: how each net price comes from what the household paid.
  doc.addPage();
  brandHeader(doc, 'Relevé de versement', s.number);
  doc.y = 122;
  label(doc, 'Détail du calcul', COLOR.terra);
  doc.y += 6;
  doc
    .font(FONT.text)
    .fontSize(9.5)
    .fillColor(COLOR.inkMid)
    .text(
      'Net = prix HT − part Labs Food − frais CESU. La TVA payée par le client est reversée à ' +
        'l’État : elle ne revient ni à Labs Food ni au prestataire.',
      PAGE.left,
      doc.y,
      { ...TEXT, width: PAGE.width, lineGap: 2 },
    );
  doc.y += 14;
  drawTable(doc, s, money);

  footer(doc, `${s.buyer.name} · autofacture ${s.number} · ${s.seller.name}`);
  doc.end();
  return done;
}

function drawTable(
  doc: PDFKit.PDFDocument,
  s: PayoutStatementSnapshot,
  money: (cents: number) => string,
) {
  const cols = [
    { title: 'Réservation', width: 74, align: 'left' as const },
    { title: 'Reçu le', width: 50, align: 'left' as const },
    { title: 'Paiement', width: 52, align: 'left' as const },
    { title: 'Prix TTC', width: 56, align: 'right' as const },
    { title: 'TVA', width: 64, align: 'right' as const },
    { title: 'Prix HT', width: 52, align: 'right' as const },
    { title: 'Part LF', width: 48, align: 'right' as const },
    { title: 'Frais CESU', width: 54, align: 'right' as const },
    { title: 'Net', width: 46, align: 'right' as const },
  ];
  const row = (cells: string[], font: string, color: string) => {
    let x = PAGE.left;
    const y = doc.y;
    cells.forEach((cell, i) => {
      doc
        .font(font)
        .fontSize(7.5)
        .fillColor(color)
        .text(cell, x, y, { ...TEXT, width: cols[i].width - 4, align: cols[i].align });
      x += cols[i].width;
    });
    doc.y = y + 16;
  };

  row(
    cols.map((c) => c.title),
    FONT.strong,
    COLOR.inkSoft,
  );
  rule(doc, doc.y - 4);
  for (const l of s.lines) {
    if (doc.y > PAGE.height - 110) doc.addPage();
    row(
      [
        l.bookingReference ?? '—',
        shortDay(l.receivedAt),
        METHOD[l.method],
        money(l.amountTtcCents),
        `${money(l.amountVatCents)} (${rate(l.vatRateBps)})`,
        money(l.amountHtCents),
        `− ${money(l.commissionCents)}`,
        l.cesuFeeCents ? `− ${money(l.cesuFeeCents)}` : '—',
        money(l.netCents),
      ],
      FONT.text,
      COLOR.ink,
    );
  }
  rule(doc, doc.y - 4);
  const blank = cols.slice(0, -1).map(() => '');
  blank[0] = 'Total versé';
  row([...blank, money(s.netCents)], FONT.strong, COLOR.navy);
}
