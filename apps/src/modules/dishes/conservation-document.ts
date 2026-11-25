import {
  brandDocument,
  brandHeader,
  COLOR,
  FONT,
  label,
  PAGE,
  panel,
  TEXT,
  toBuffer,
} from '../../common/pdf/brand';

/**
 * Recettes lot 3 (LF-0272, §11): the conservation sheet as a PDF, for the client.
 * One panel per dish, shortest date first: until when, how to keep it, how to
 * reheat it. Never quantities nor steps (R51).
 */
export interface ConservationDocumentInput {
  /** The prestation's day, as printed: "vendredi 20 novembre 2026". */
  day: string;
  dishes: {
    name: string;
    /** "lundi 23 novembre", or null when the recipe gives no fridge days. */
    eatBefore: string | null;
    storage: string | null;
    freezer: string | null;
    reheating: string | null;
    chefNote: string | null;
  }[];
}

export function renderConservationPdf(input: ConservationDocumentInput): Promise<Buffer> {
  const doc = brandDocument({
    Title: `Fiche de conservation du ${input.day}`,
    Author: "Lab's Food",
    Subject: 'Fiche de conservation',
  });
  const done = toBuffer(doc);

  brandHeader(doc, 'Fiche de conservation', input.day);
  doc.y = 122;
  label(doc, 'Vos plats', COLOR.terra);
  doc.y += 6;
  doc
    .font(FONT.display)
    .fontSize(22)
    .fillColor(COLOR.navy)
    .text('À manger avant', PAGE.left, doc.y, { ...TEXT, width: PAGE.width });
  doc.y += 2;
  doc
    .font(FONT.text)
    .fontSize(10)
    .fillColor(COLOR.inkMid)
    .text(
      'Du plus court au plus long délai. Gardez vos plats au réfrigérateur dès leur ' +
        'livraison, et réchauffez-les à cœur.',
      { ...TEXT, width: PAGE.width },
    );

  for (const dish of input.dishes) {
    doc.y += 20;
    // A dish never splits across pages: start a new one when it would not fit.
    if (doc.y > PAGE.height - 240) {
      doc.addPage();
      doc.y = 60;
    }
    doc
      .font(FONT.display)
      .fontSize(14)
      .fillColor(COLOR.navy)
      .text(dish.name, PAGE.left, doc.y, { ...TEXT, width: PAGE.width });
    doc.y += 6;
    panel(doc, COLOR.cream, COLOR.inkSoft, [
      {
        label: 'À manger avant',
        value: dish.eatBefore ?? 'Date à demander au batch cooker',
        strong: true,
      },
      ...(dish.storage ? [{ label: 'Conservation', value: dish.storage }] : []),
      ...(dish.freezer ? [{ label: 'Congélation', value: dish.freezer }] : []),
      ...(dish.reheating ? [{ label: 'Réchauffage', value: dish.reheating }] : []),
      ...(dish.chefNote ? [{ label: 'Le mot du chef', value: dish.chefNote }] : []),
    ]);
  }
  doc.end();
  return done;
}

/** `conservation-2026-11-20.pdf` */
export const conservationFilename = (ymd: string) => `conservation-${ymd}.pdf`;
