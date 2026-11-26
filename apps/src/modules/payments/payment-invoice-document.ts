import PDFDocument from 'pdfkit';

import {
  brandHeader,
  COLOR,
  FONT,
  footer,
  label,
  PAGE,
  panel,
  Row,
  section,
  TEXT,
  toBuffer,
} from '../../common/pdf/brand';
import type { InvoiceLine } from './domain/payment-invoices.rules';

/**
 * Facture A as a PDF: the invoice the client receives for a card payment, in the chef's
 * name, drawn in the batchcooking site's identity.
 *
 * Everything on the page comes from `PaymentInvoiceSnapshot`, frozen on the invoice row
 * when it is numbered: a redraw after a failed upload gives the same document, whatever
 * happened to the booking or the chef's profile since.
 *
 * PDF/A-3b, like the SEPA mandate: kept for the ten-year retention, and the format
 * Factur-X will need.
 */

const PLATFORM_NAME = "LAB'S FOOD";

export interface PaymentInvoiceSnapshot {
  /**
   * Who sells. Absent or `chef`: facture A, in the batch cooker's name (former
   * invoicing). `sas`: Labs Food Batchcooking SAS invoices in its own name, with VAT
   * (« prix net », 26/11/2026), whatever the payment method.
   */
  issuer?: 'chef' | 'sas';
  /** `sas` only: the VAT the SAS charges (10 %, services à la personne). */
  vat?: { rateBps: number; htCents: number; vatCents: number };
  /** `sas` only: « carte bancaire », « CESU », « avance immédiate ». */
  methodLabel?: string;
  invoiceNumber: string;
  /** ISO instants: the snapshot lives in a JSON column. */
  issuedAt: string;
  paidAt: string;
  currency: string;
  amountTtcCents: number;
  lines: InvoiceLine[];
  seller: {
    displayName: string;
    city: string | null;
    /** SAP declaration number, when the chef declared one. */
    sapDeclarationNumber: string | null;
    /** `sas` only. */
    siren?: string | null;
    address?: string | null;
  };
  client: { name: string; email: string };
  booking: {
    reference: string | null;
    /** Where the prestation took place, already joined into one line. */
    address: string | null;
    startsAt: string;
  };
}

const parisDay = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', {
    timeZone: 'Europe/Paris',
    dateStyle: 'long',
  });

/**
 * `12 345,60 €`. Not `Intl` currency: its narrow no-break spaces are missing from the
 * embedded face and print as an empty box.
 */
export function formatMoney(cents: number, currency: string): string {
  const [whole, decimals] = (Math.abs(cents) / 100).toFixed(2).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const symbol = currency === 'EUR' ? '€' : currency;
  return `${cents < 0 ? '-' : ''}${grouped},${decimals} ${symbol}`;
}

export function renderPaymentInvoicePdf(
  snapshot: PaymentInvoiceSnapshot,
): Promise<Buffer> {
  const { seller, client, booking } = snapshot;
  const sas = snapshot.issuer === 'sas';
  const doc = new PDFDocument({
    size: 'A4',
    margin: 50,
    pdfVersion: '1.7',
    subset: 'PDF/A-3b',
    font: FONT.text,
    lang: 'fr-FR',
    info: {
      Title: `Facture ${snapshot.invoiceNumber}`,
      Author: seller.displayName,
      Subject: `Facture de prestation${booking.reference ? ` ${booking.reference}` : ''}`,
    },
  });
  const done = toBuffer(doc);

  brandHeader(doc, 'Facture', snapshot.invoiceNumber);

  doc.y = 122;
  label(doc, `Émise le ${parisDay(snapshot.issuedAt)}`, COLOR.terra);
  doc.y += 6;
  doc
    .font(FONT.display)
    .fontSize(24)
    .fillColor(COLOR.navy)
    .text('Facture de prestation', PAGE.left, doc.y, TEXT);
  doc.y += 2;
  doc
    .font(FONT.text)
    .fontSize(10)
    .fillColor(COLOR.inkMid)
    .text(
      `Réglée par ${snapshot.methodLabel ?? 'carte bancaire'} le ${parisDay(snapshot.paidAt)}`,
      TEXT,
    );

  doc.y += 18;
  const parties: Row[] = [
    {
      label: 'Prestataire',
      value: [
        seller.displayName,
        sas ? seller.address : seller.city,
        sas && seller.siren ? `SIREN ${seller.siren}` : null,
        seller.sapDeclarationNumber
          ? `Déclaration SAP n° ${seller.sapDeclarationNumber}`
          : null,
      ]
        .filter(Boolean)
        .join('\n'),
      strong: true,
    },
    { label: 'Client', value: [client.name, client.email].filter(Boolean).join('\n') },
    {
      label: 'Prestation',
      value: [
        booking.reference ? `Réservation ${booking.reference}` : null,
        `Le ${parisDay(booking.startsAt)}`,
        booking.address,
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ];
  panel(doc, COLOR.cream, COLOR.inkSoft, parties);

  doc.y += 20;
  label(doc, 'Détail', COLOR.terra);
  doc.y += 6;
  panel(doc, COLOR.cream, COLOR.inkSoft, [
    ...snapshot.lines.map((line) => ({
      label: line.label,
      value: formatMoney(line.amountCents, snapshot.currency),
    })),
    ...(sas && snapshot.vat
      ? [
          {
            label: 'Total HT',
            value: formatMoney(snapshot.vat.htCents, snapshot.currency),
          },
          {
            label: `TVA ${(snapshot.vat.rateBps / 100).toLocaleString('fr-FR')} %`,
            value: formatMoney(snapshot.vat.vatCents, snapshot.currency),
          },
        ]
      : []),
    {
      label: sas ? 'Total TTC payé' : 'Total payé',
      value: formatMoney(snapshot.amountTtcCents, snapshot.currency),
      strong: true,
    },
  ]);

  if (sas) {
    section(
      doc,
      'Mentions',
      `Prestation de services à la personne réalisée au domicile du client par ` +
        `${seller.displayName}, prestataire, qui encaisse ce règlement en son nom. ` +
        'Les sommes versées ouvrent droit au crédit d’impôt prévu à l’article ' +
        '199 sexdecies du code général des impôts, dans ses conditions et limites. ' +
        'Une attestation fiscale annuelle vous est délivrée.',
    );
  } else {
    section(
      doc,
      'Mentions',
      `Facture établie au nom et pour le compte de ${seller.displayName} par ` +
        `${PLATFORM_NAME}, qui encaisse le règlement par l’intermédiaire de Stripe. ` +
        'Le montant ci-dessus est celui débité de votre carte.',
    );
  }

  footer(
    doc,
    sas
      ? `${seller.displayName} · facture ${snapshot.invoiceNumber}`
      : `Document établi par ${PLATFORM_NAME} pour ${seller.displayName} · facture ${snapshot.invoiceNumber}`,
  );

  doc.end();
  return done;
}
