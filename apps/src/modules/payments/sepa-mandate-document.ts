import PDFDocument from 'pdfkit';

/**
 * The signed SEPA mandate as a PDF, filed in the chef's dossier.
 *
 * The mandate itself lives at Stripe: Checkout showed the text, collected the IBAN and
 * recorded the acceptance. This document is the platform's copy of that proof — the
 * unique mandate reference (RUM), who signed, when, and from where — so an admin can
 * produce it without opening Stripe.
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

// ICU's French formats can carry narrow no-break spaces, which Helvetica cannot print.
const parisTime = (date: Date) =>
  date
    .toLocaleString('fr-FR', {
      timeZone: 'Europe/Paris',
      dateStyle: 'long',
      timeStyle: 'short',
    })
    .replace(/[ -​ ]/g, ' ');

export function renderMandatePdf(input: MandateDocumentInput): Promise<Buffer> {
  const creditor = input.creditorName;
  const doc = new PDFDocument({
    size: 'A4',
    margin: 50,
    info: {
      Title: `Mandat de prélèvement SEPA ${input.reference}`,
      Author: creditor,
      Subject: 'Mandat de prélèvement SEPA (Core)',
    },
  });
  const done = toBuffer(doc);

  const section = (title: string) =>
    doc.moveDown(0.9).font('Helvetica-Bold').fontSize(10).text(title);
  const line = (text: string) => doc.font('Helvetica').fontSize(10).text(text);

  doc.font('Helvetica-Bold').fontSize(16).text('Mandat de prélèvement SEPA');
  line(`Commissions ${creditor} – prélèvement récurrent (SEPA Core)`);

  section('Référence unique du mandat (RUM)');
  line(input.reference);

  section('Créancier');
  line(`${creditor}, par l’intermédiaire de Stripe, son prestataire de paiement`);

  section('Débiteur');
  line(input.debtorName);
  if (input.debtorEmail) line(input.debtorEmail);
  line(
    input.ibanLast4
      ? `Compte débité : IBAN se terminant par ${input.ibanLast4}`
      : 'Compte débité : IBAN enregistré chez Stripe',
  );

  section('Objet');
  line(
    `Commissions dues à ${creditor} sur les prestations réglées hors carte bancaire ` +
      '(CESU préfinancé, avance immédiate URSSAF), chacune facturée par une facture ' +
      'de commission avant d’être prélevée.',
  );

  section('Autorisation');
  line(
    `En signant ce mandat, vous autorisez ${creditor} et Stripe, son prestataire de ` +
      'paiement, à envoyer des instructions à votre banque pour débiter votre compte, ' +
      `et votre banque à débiter votre compte conformément aux instructions de ${creditor}. ` +
      'Vous bénéficiez du droit d’être remboursé par votre banque selon les conditions ' +
      'décrites dans la convention que vous avez passée avec elle. Une demande de ' +
      'remboursement doit être présentée dans les 8 semaines suivant la date de débit ' +
      'de votre compte pour un prélèvement autorisé. Vos droits concernant le présent ' +
      'mandat sont expliqués dans un document que vous pouvez obtenir auprès de votre banque.',
  );

  section('Signature');
  line(
    `Signé électroniquement le ${parisTime(input.signedAt)} (heure de Paris), ` +
      'sur la page sécurisée de Stripe.',
  );
  if (input.acceptance?.ipAddress) line(`Adresse IP : ${input.acceptance.ipAddress}`);
  if (input.acceptance?.userAgent) {
    line(`Navigateur : ${input.acceptance.userAgent.slice(0, 240)}`);
  }
  line(`Identifiant Stripe du mandat : ${input.stripeMandateId}`);

  doc
    .moveDown(1.6)
    .font('Helvetica')
    .fontSize(8)
    .text(
      `Document établi par ${creditor} le ${parisTime(input.generatedAt ?? new Date())}. ` +
        'Le mandat fait foi tel qu’enregistré par Stripe.',
    );

  doc.end();
  return done;
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
