import { join } from 'node:path';

import PDFDocument from 'pdfkit';

/**
 * The batchcooking site's identity on paper, shared by the documents the API
 * prints (SEPA mandate, recipe sheet): its logo, palette and three typefaces,
 * embedded for PDF/A.
 */

// PDF/A refuses the 14 standard fonts, which a reader substitutes: the fonts travel in
// the file. The site's faces, all SIL OFL (licences beside them in src/assets/fonts);
// nest-cli copies src/assets next to the compiled code, so these paths hold in src and
// in dist.
export const ASSETS = join(__dirname, '../../assets');
export const FONT = {
  text: join(ASSETS, 'fonts/Montserrat-Regular.ttf'),
  strong: join(ASSETS, 'fonts/Montserrat-Bold.ttf'),
  display: join(ASSETS, 'fonts/Fraunces-Bold.ttf'),
  mono: join(ASSETS, 'fonts/DMMono-Medium.ttf'),
};
export const LOGO = join(ASSETS, 'brand/logo-orange.png');

/** batchcooking-web's palette (tailwind.config.ts). */
export const COLOR = {
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
export const PAGE = { left: 50, width: 495.28, height: 841.89 };

// No "fi" ligature: some readers copy it as "f", so "préfinancé" would not be found by
// a search. fontkit takes a tag → boolean map; @types/pdfkit only types the array form.
export const TEXT = {
  features: { liga: false } as unknown as PDFKit.Mixins.OpenTypeFeatures[],
};

/** The site's `.label-brand`: DM Mono, uppercase, 0.18em tracking. */
export const LABEL = { ...TEXT, characterSpacing: 7 * 0.18 };

export interface Row {
  label: string;
  value: string;
  strong?: boolean;
}

/** The site's `<Logo>`: the mascot, "Lab's Food" in Fraunces, "Batch cooking" in mono. */
export function brandHeader(doc: PDFKit.PDFDocument, caption: string, value: string) {
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
    .text(caption.toUpperCase(), PAGE.left, 54, {
      ...LABEL,
      width: PAGE.width,
      align: 'right',
    });
  doc
    .font(FONT.strong)
    .fontSize(10)
    .fillColor(COLOR.navy)
    .text(value, PAGE.left, 66, { ...TEXT, width: PAGE.width, align: 'right' });

  rule(doc, 100);
}

export function label(doc: PDFKit.PDFDocument, text: string, color: string) {
  doc
    .font(FONT.mono)
    .fontSize(7)
    .fillColor(color)
    .text(text.toUpperCase(), PAGE.left, doc.y, { ...LABEL, width: PAGE.width });
}

export function section(doc: PDFKit.PDFDocument, title: string, body: string) {
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
export function panel(
  doc: PDFKit.PDFDocument,
  fill: string,
  labelColor: string,
  rows: Row[],
) {
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
export function footer(doc: PDFKit.PDFDocument, text: string) {
  doc.page.margins.bottom = 0;
  const y = PAGE.height - 62;
  rule(doc, y);
  doc
    .font(FONT.mono)
    .fontSize(6.5)
    .fillColor(COLOR.inkSoft)
    .text(text, PAGE.left, y + 9, { ...TEXT, characterSpacing: 0.3, width: PAGE.width });
}

export function rule(doc: PDFKit.PDFDocument, y: number) {
  doc
    .moveTo(PAGE.left, y)
    .lineTo(PAGE.left + PAGE.width, y)
    .lineWidth(0.75)
    .strokeColor(COLOR.rule)
    .stroke();
}

/** PDFKit streams its output; this collects it once `end()` has been called. */
export function toBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

/** A4, PDF/A-3b, the site's text face, French; every page kept until the end. */
export function brandDocument(info: { Title: string; Author: string; Subject: string }) {
  return new PDFDocument({
    size: 'A4',
    margin: 50,
    pdfVersion: '1.7',
    subset: 'PDF/A-3b',
    font: FONT.text,
    lang: 'fr-FR',
    bufferPages: true,
    info,
  });
}
