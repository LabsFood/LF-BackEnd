import { join } from 'node:path';

import PDFDocument from 'pdfkit';

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

// PDF/A refuses the 14 standard fonts, which a reader substitutes: the fonts travel in
// the file. The site's faces, all SIL OFL (licences beside them in src/assets/fonts);
// nest-cli copies src/assets next to the compiled code, so these paths hold in src and
// in dist.
const ASSETS = join(__dirname, '../../assets');
const FONT = {
  text: join(ASSETS, 'fonts/Montserrat-Regular.ttf'),
  strong: join(ASSETS, 'fonts/Montserrat-Bold.ttf'),
  display: join(ASSETS, 'fonts/Fraunces-Bold.ttf'),
  mono: join(ASSETS, 'fonts/DMMono-Medium.ttf'),
};
const LOGO = join(ASSETS, 'brand/logo-orange.png');

/** batchcooking-web's palette (tailwind.config.ts). */
const COLOR = {
  navy: '#2C3E50',
  terra: '#F39C12',
  ink: '#1F2A37',
  inkMid: '#4B5867',
  inkSoft: '#7B8794',
  mint: '#D1F2EB',
  mintInk: '#14695F',
  cream: '#F1F5F8',
  rule: '#E5ECF1',
};

/** A4 inside 50 pt margins. */
const PAGE = { left: 50, width: 495.28, height: 841.89 };

// No "fi" ligature: some readers copy it as "f", so "préfinancé" would not be found by
// a search. fontkit takes a tag → boolean map; @types/pdfkit only types the array form.
const TEXT = { features: { liga: false } as unknown as PDFKit.Mixins.OpenTypeFeatures[] };

/** The site's `.label-brand`: DM Mono, uppercase, 0.18em tracking. */
const LABEL = { ...TEXT, characterSpacing: 7 * 0.18 };

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

interface Row {
  label: string;
  value: string;
  strong?: boolean;
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

  header(doc, input.reference);

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

/** The site's `<Logo>`: the mascot, "Lab's Food" in Fraunces, "Batch cooking" in mono. */
function header(doc: PDFKit.PDFDocument, reference: string) {
  doc.image(LOGO, PAGE.left, 44, { height: 40 });
  doc
    .font(FONT.display)
    .fontSize(17)
    .fillColor(COLOR.terra)
    .text("Lab's Food", PAGE.left + 44, 50, TEXT);
  doc
    .font(FONT.mono)
    .fontSize(6.5)
    .fillColor(COLOR.inkSoft)
    .text('BATCH COOKING', PAGE.left + 44, 72, LABEL);

  doc
    .font(FONT.mono)
    .fontSize(6.5)
    .fillColor(COLOR.inkSoft)
    .text('RÉFÉRENCE DU MANDAT', PAGE.left, 54, {
      ...LABEL,
      width: PAGE.width,
      align: 'right',
    });
  doc
    .font(FONT.strong)
    .fontSize(10)
    .fillColor(COLOR.navy)
    .text(reference, PAGE.left, 66, { ...TEXT, width: PAGE.width, align: 'right' });

  rule(doc, 100);
}

function label(doc: PDFKit.PDFDocument, text: string, color: string) {
  doc
    .font(FONT.mono)
    .fontSize(7)
    .fillColor(color)
    .text(text.toUpperCase(), PAGE.left, doc.y, { ...LABEL, width: PAGE.width });
}

function section(doc: PDFKit.PDFDocument, title: string, body: string) {
  doc.y += 20;
  label(doc, title, COLOR.terra);
  doc.y += 5;
  doc
    .font(FONT.text)
    .fontSize(9.5)
    .fillColor(COLOR.ink)
    .text(body, PAGE.left, doc.y, { ...TEXT, width: PAGE.width, lineGap: 2 });
}

/**
 * Label → value rows on a rounded panel, the way the site lays out a booking's
 * details. Measured first: the fill has to be painted before the text it sits under.
 */
function panel(doc: PDFKit.PDFDocument, fill: string, labelColor: string, rows: Row[]) {
  const pad = 16;
  const gap = 9;
  const labelWidth = 118;
  const valueX = PAGE.left + pad + labelWidth + 12;
  const valueWidth = PAGE.width - pad * 2 - labelWidth - 12;
  const labelOptions = { ...LABEL, width: labelWidth };
  const valueOptions = { ...TEXT, width: valueWidth, lineGap: 1.5 };

  const heights = rows.map((row) =>
    Math.max(
      doc
        .font(FONT.mono)
        .fontSize(7)
        .heightOfString(row.label.toUpperCase(), labelOptions),
      doc
        .font(row.strong ? FONT.strong : FONT.text)
        .fontSize(10)
        .heightOfString(row.value, valueOptions),
    ),
  );
  const top = doc.y;
  const height =
    pad * 2 + heights.reduce((sum, h) => sum + h, 0) + gap * (rows.length - 1);
  doc.roundedRect(PAGE.left, top, PAGE.width, height, 10).fill(fill);

  let y = top + pad;
  rows.forEach((row, i) => {
    doc
      .font(FONT.mono)
      .fontSize(7)
      .fillColor(labelColor)
      .text(row.label.toUpperCase(), PAGE.left + pad, y + 2.5, labelOptions);
    doc
      .font(row.strong ? FONT.strong : FONT.text)
      .fontSize(10)
      .fillColor(row.strong ? COLOR.navy : COLOR.ink)
      .text(row.value, valueX, y, valueOptions);
    y += heights[i] + gap;
  });
  doc.x = PAGE.left;
  doc.y = top + height;
}

/** Pinned to the foot of the page, below the bottom margin PDFKit would break on. */
function footer(doc: PDFKit.PDFDocument, text: string) {
  doc.page.margins.bottom = 0;
  const y = PAGE.height - 62;
  rule(doc, y);
  doc
    .font(FONT.mono)
    .fontSize(6.5)
    .fillColor(COLOR.inkSoft)
    .text(text, PAGE.left, y + 9, { ...TEXT, characterSpacing: 0.3, width: PAGE.width });
}

function rule(doc: PDFKit.PDFDocument, y: number) {
  doc
    .moveTo(PAGE.left, y)
    .lineTo(PAGE.left + PAGE.width, y)
    .lineWidth(0.75)
    .strokeColor(COLOR.rule)
    .stroke();
}

/** PDFKit streams its output; this collects it once `end()` has been called. */
function toBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}
