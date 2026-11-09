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

/**
 * The signed SEPA mandate as a PDF, filed in the chef's dossier.
 *
 * The mandate itself lives at Stripe: Checkout showed the text, collected the IBAN and
 * recorded the acceptance. This document is the platform's copy of that proof — the
 * unique mandate reference (RUM), who signed, when, and from where — so an admin can
 * produce it without opening Stripe.
 *
 * PDF/A-3b, the archival format: it is kept for as long as the mandate can be
 * contested, and it is the format Factur-X invoices will need too. It wears the
 * batchcooking site's identity: its logo, palette and three typefaces.
 */

export interface MandateDocumentInput {
  /** Unique mandate reference (RUM), as Stripe assigned it. */
  reference: string;
  stripeMandateId: string;
  creditorName: string;
  debtorName: string;
  debtorEmail: string | null;
  ibanLast4: string | null;
  signedAt: Date;
  acceptance: { ipAddress: string | null; userAgent: string | null } | null;
  generatedAt?: Date;
}

const parisTime = (date: Date) =>
  date.toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    dateStyle: 'long',
    timeStyle: 'short',
  });

export function renderMandatePdf(input: MandateDocumentInput): Promise<Buffer> {
  const creditor = input.creditorName;
  const doc = new PDFDocument({
    size: 'A4',
    margin: 50,
    pdfVersion: '1.7',
    subset: 'PDF/A-3b',
    font: FONT.text,
    lang: 'fr-FR',
    info: {
      Title: `Mandat de prélèvement SEPA ${input.reference}`,
      Author: creditor,
      Subject: 'Mandat de prélèvement SEPA (Core)',
    },
  });
  const done = toBuffer(doc);

  brandHeader(doc, 'Référence du mandat', input.reference);

  doc.y = 122;
  label(doc, `Commissions ${creditor}`, COLOR.terra);
  doc.y += 6;
  doc
    .font(FONT.display)
    .fontSize(24)
    .fillColor(COLOR.navy)
    .text('Mandat de prélèvement SEPA', PAGE.left, doc.y, TEXT);
  doc.y += 2;
  doc
    .font(FONT.text)
    .fontSize(10)
    .fillColor(COLOR.inkMid)
    .text('Prélèvement récurrent (SEPA Core)', TEXT);

  doc.y += 18;
  panel(doc, COLOR.cream, COLOR.inkSoft, [
    { label: 'Référence (RUM)', value: input.reference, strong: true },
    {
      label: 'Créancier',
      value: `${creditor}, par l’intermédiaire de Stripe, son prestataire de paiement`,
    },
    {
      label: 'Débiteur',
      value: [input.debtorName, input.debtorEmail].filter(Boolean).join('\n'),
    },
    {
      label: 'Compte débité',
      value: input.ibanLast4
        ? `IBAN se terminant par ${input.ibanLast4}`
        : 'IBAN enregistré chez Stripe',
    },
  ]);

  section(
    doc,
    'Objet',
    `Commissions dues à ${creditor} sur les prestations réglées hors carte bancaire ` +
      '(CESU préfinancé, avance immédiate URSSAF), chacune facturée par une facture ' +
      'de commission avant d’être prélevée.',
  );
  section(
    doc,
    'Autorisation',
    `En signant ce mandat, vous autorisez ${creditor} et Stripe, son prestataire de ` +
      'paiement, à envoyer des instructions à votre banque pour débiter votre compte, ' +
      `et votre banque à débiter votre compte conformément aux instructions de ${creditor}. ` +
      'Vous bénéficiez du droit d’être remboursé par votre banque selon les conditions ' +
      'décrites dans la convention que vous avez passée avec elle. Une demande de ' +
      'remboursement doit être présentée dans les 8 semaines suivant la date de débit ' +
      'de votre compte pour un prélèvement autorisé. Vos droits concernant le présent ' +
      'mandat sont expliqués dans un document que vous pouvez obtenir auprès de votre banque.',
  );

  doc.y += 20;
  label(doc, 'Signature électronique', COLOR.mintInk);
  doc.y += 6;
  const signature: Row[] = [
    {
      label: 'Signé le',
      value:
        `${parisTime(input.signedAt)} (heure de Paris), ` +
        'sur la page sécurisée de Stripe.',
    },
  ];
  if (input.acceptance?.ipAddress) {
    signature.push({ label: 'Adresse IP', value: input.acceptance.ipAddress });
  }
  if (input.acceptance?.userAgent) {
    signature.push({
      label: 'Navigateur',
      value: input.acceptance.userAgent.slice(0, 240),
    });
  }
  signature.push({ label: 'Mandat Stripe', value: input.stripeMandateId });
  panel(doc, COLOR.mint, COLOR.mintInk, signature);

  footer(
    doc,
    `Document établi par ${creditor} le ${parisTime(input.generatedAt ?? new Date())}. ` +
      'Le mandat fait foi tel qu’enregistré par Stripe.',
  );

  doc.end();
  return done;
}
