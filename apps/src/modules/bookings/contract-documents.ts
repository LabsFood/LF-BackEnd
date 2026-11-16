import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  ASSETS,
  brandDocument,
  brandHeader,
  COLOR,
  FONT,
  footer,
  label,
  PAGE,
  panel,
  section,
  TEXT,
  toBuffer,
} from '../../common/pdf/brand';
import { WITHDRAWAL_DECLARATION } from './domain/withdrawal.rules';

/**
 * The documents of a booking's contract (CGV art. 2.4): the CGV as published, the
 * withdrawal form of Annexe 1 pre-filled, and the particular débours mandate of
 * Annexe 3. The last two are built on demand from the booking; nothing is stored.
 */

const COMPANY = "LAB'S FOOD";
/** The publisher, as the Mentions légales V1 name it. */
const LEGAL_NAME = "LAB'S FOOD - BATCHCOOKING";
const POSTAL_ADDRESS = '200 rue de la Croix Nivert, 75015 Paris';
const WITHDRAWAL_EMAIL = 'retractation@labsfood.fr';

const day = (date: Date) =>
  date.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long' });
const dayTime = (date: Date) =>
  date.toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    dateStyle: 'long',
    timeStyle: 'short',
  });

/**
 * The CGV PDF of a version, as legal published it. One file per version, kept for
 * good: a contract is archived 10 years (L.213-1), on the terms of its own day.
 */
export const cgvPath = (version: string) => join(ASSETS, 'legal', `cgv-${version}.pdf`);
export const cgvPdf = (version: string) => readFile(cgvPath(version));

function title(doc: PDFKit.PDFDocument, kicker: string, text: string, sub: string) {
  doc.y = 122;
  label(doc, kicker, COLOR.terra);
  doc.y += 6;
  doc
    .font(FONT.display)
    .fontSize(24)
    .fillColor(COLOR.navy)
    .text(text, PAGE.left, doc.y, TEXT);
  doc.y += 2;
  doc.font(FONT.text).fontSize(10).fillColor(COLOR.inkMid).text(sub, TEXT);
  doc.y += 18;
}

export interface WithdrawalFormInput {
  reference: string;
  chefName: string;
  /** When the booking was made: the form's « Prestation réservée le ». */
  bookedOn: Date;
  clientName: string;
  clientAddress: string | null;
  generatedAt?: Date;
}

/** Annexe 1, pre-filled; Annexe 2's information follows it. */
export function renderWithdrawalFormPdf(input: WithdrawalFormInput): Promise<Buffer> {
  const doc = brandDocument({
    Title: `Formulaire de rétractation ${input.reference}`,
    Author: COMPANY,
    Subject: 'Formulaire de rétractation (Annexe 1 des CGV)',
  });
  const done = toBuffer(doc);

  brandHeader(doc, 'Réservation', input.reference);
  title(
    doc,
    'Annexe 1 des CGV',
    'Formulaire de rétractation',
    'À compléter et renvoyer uniquement si vous souhaitez vous rétracter du contrat.',
  );

  section(
    doc,
    'Destinataire',
    `À l’attention de ${LEGAL_NAME}, agissant au nom et pour le compte du batch ` +
      `cooker concerné : par e-mail à ${WITHDRAWAL_EMAIL}, ou par courrier recommandé ` +
      `avec accusé de réception au ${POSTAL_ADDRESS}. Vous pouvez aussi utiliser le ` +
      'bouton « Se rétracter » de votre espace, rubrique « Mes sessions ».',
  );
  section(doc, 'Déclaration', WITHDRAWAL_DECLARATION);
  doc.y += 10;
  panel(doc, COLOR.cream, COLOR.inkSoft, [
    { label: 'Prestation réservée le', value: day(input.bookedOn) },
    {
      label: 'Batch cooker et réservation',
      value: `${input.chefName} — ${input.reference}`,
      strong: true,
    },
    { label: 'Nom du consommateur', value: input.clientName },
    { label: 'Adresse du consommateur', value: input.clientAddress ?? '…' },
    { label: 'Signature (sur papier seulement)', value: '…' },
    { label: 'Date', value: '…' },
  ]);

  section(
    doc,
    'Annexe 2 — Votre droit de rétractation',
    'Vous avez le droit de vous rétracter du présent contrat sans donner de motif dans ' +
      'un délai de quatorze jours après le jour de sa conclusion. Il suffit que vous ' +
      'transmettiez votre décision avant l’expiration de ce délai, par une déclaration ' +
      'dénuée d’ambiguïté. En cas de rétractation, nous vous remboursons tous les ' +
      'paiements reçus de vous au plus tard quatorze jours après en avoir été informés, ' +
      'par le même moyen de paiement, sans frais. Si vous avez demandé que la prestation ' +
      'commence pendant le délai de rétractation, vous payez la part déjà fournie ; les ' +
      'produits achetés pour vous vous sont remis et leur coût exact reste dû.',
  );

  footer(
    doc,
    `Document établi par ${COMPANY} le ${dayTime(input.generatedAt ?? new Date())}.`,
  );
  doc.end();
  return done;
}

export interface DeboursMandateInput {
  reference: string;
  clientName: string;
  chefName: string;
  chefSiren: string | null;
  startsAt: Date;
  address: string | null;
  meals: string[];
  /**
   * The shopping list as it stands, grouped by aisle in store order (16/11): each
   * aisle's label and its lines. Empty while it is not drawn up.
   */
  shopping: { aisle: string; lines: string[] }[];
  acceptedAt: Date;
  version: string;
  generatedAt?: Date;
}

/**
 * The particular mandate of Annexe 3, generated on demand. Ticking the mandate box
 * stands as its signature (CGU).
 *
 * ponytail: no Budget Courses line, the platform has none yet (mandate lot 2); add
 * it with the budget field.
 */
export function renderDeboursMandatePdf(input: DeboursMandateInput): Promise<Buffer> {
  const doc = brandDocument({
    Title: `Mandat de débours ${input.reference}`,
    Author: COMPANY,
    Subject: 'Mandat de débours (Annexe 3 des CGV)',
  });
  const done = toBuffer(doc);

  brandHeader(doc, 'Réservation', input.reference);
  title(
    doc,
    'Annexe 3 des CGV',
    'Mandat de débours',
    'Mandat particulier : l’achat de vos courses en votre nom, sans marge.',
  );

  panel(doc, COLOR.cream, COLOR.inkSoft, [
    { label: 'Mandant', value: input.clientName, strong: true },
    {
      label: 'Mandataire',
      value: `${LEGAL_NAME}, SASU, ${POSTAL_ADDRESS} (RCS Paris 131 895 203)`,
    },
    {
      label: 'Personne désignée pour les achats',
      value: [input.chefName, input.chefSiren && `SIREN ${input.chefSiren}`]
        .filter(Boolean)
        .join(' — '),
    },
    {
      label: 'Prestation',
      value: [`${dayTime(input.startsAt)}`, input.address].filter(Boolean).join('\n'),
    },
    {
      label: 'Menu',
      value: input.meals.join(', ') || 'À définir avec votre batch cooker',
    },
  ]);

  if (!input.shopping.length) {
    section(
      doc,
      'Liste de Courses',
      'La liste de courses n’est pas encore établie : elle est envoyée dans votre ' +
        'espace au plus tard au Verrouillage (48 heures avant la prestation).',
    );
  } else {
    // One block per aisle, in store order: the list reads the way the chef shops.
    doc.y += 20;
    label(doc, 'Liste de Courses', COLOR.terra);
    for (const group of input.shopping) {
      doc.y += 8;
      label(doc, group.aisle, COLOR.inkSoft);
      doc.y += 3;
      doc
        .font(FONT.text)
        .fontSize(9.5)
        .fillColor(COLOR.ink)
        .text(group.lines.join('\n'), PAGE.left, doc.y, {
          ...TEXT,
          width: PAGE.width,
          lineGap: 2,
        });
    }
  }
  section(
    doc,
    'Objet et prix',
    `Le mandant charge ${COMPANY} d’acheter, en son nom et pour son compte, les produits ` +
      'de la Liste de Courses validée. Le mandat est gratuit : ni marge, ni commission, ' +
      'ni frais. Les courses sont refacturées au centime près.',
  );
  section(
    doc,
    'Achats',
    'Le batch cooker choisi par le mandant achète les courses à la place du mandataire ' +
      '(article 1994 du Code civil) : le mandant peut agir directement contre lui. Les ' +
      'achats se font après le Verrouillage uniquement ; les produits appartiennent au ' +
      'mandant dès l’achat. Les tickets de caisse sont déposés sur la plateforme dans ' +
      'les 24 heures et rattachés à la réservation.',
  );
  section(
    doc,
    'Remboursement et révocation',
    'Le montant exact des débours est prélevé sur la carte du mandant 24 heures après ' +
      'le dépôt des justificatifs ; une ligne peut être contestée sous 48 heures. Les ' +
      'débours n’ouvrent pas droit au crédit d’impôt. Le mandat est révocable librement ' +
      'et gratuitement jusqu’au Verrouillage ; ensuite, les achats déjà faits restent dus.',
  );

  // The acceptance block and the footer must not meet: a page of their own if need be.
  if (doc.y > PAGE.height - 230) doc.addPage();
  doc.y += 20;
  label(doc, 'Acceptation', COLOR.mintInk);
  doc.y += 6;
  panel(doc, COLOR.mint, COLOR.mintInk, [
    {
      label: 'Accepté en ligne le',
      value:
        `${dayTime(input.acceptedAt)} (heure de Paris), CGV version ${input.version}, ` +
        'par la case dédiée du parcours de réservation. Cette acceptation vaut signature ' +
        'du mandat et de ses conditions.',
    },
  ]);

  footer(
    doc,
    `Document établi par ${COMPANY} le ${dayTime(input.generatedAt ?? new Date())}.`,
  );
  doc.end();
  return done;
}
