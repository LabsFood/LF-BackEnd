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

const parisTime = (date: Date) =>
  date.toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    dateStyle: 'long',
    timeStyle: 'short',
  });

export function renderMandatePdf(input: MandateDocumentInput): Buffer {
  const creditor = input.creditorName;
  const lines: PdfLine[] = [
    { text: 'Mandat de prélèvement SEPA', size: 16, bold: true },
    { text: `Commissions ${creditor} - prélèvement récurrent (SEPA Core)`, gap: 2 },

    { text: 'Référence unique du mandat (RUM)', bold: true, gap: 14 },
    { text: input.reference },

    { text: 'Créancier', bold: true, gap: 10 },
    { text: `${creditor}, par l'intermédiaire de Stripe, son prestataire de paiement` },

    { text: 'Débiteur', bold: true, gap: 10 },
    { text: input.debtorName },
    ...(input.debtorEmail ? [{ text: input.debtorEmail }] : []),
    {
      text: input.ibanLast4
        ? `Compte débité : IBAN se terminant par ${input.ibanLast4}`
        : 'Compte débité : IBAN enregistré chez Stripe',
    },

    { text: 'Objet', bold: true, gap: 10 },
    ...wrap(
      `Commissions dues à ${creditor} sur les prestations réglées hors carte bancaire ` +
        '(CESU préfinancé, avance immédiate URSSAF), chacune facturée par une facture ' +
        'de commission avant d’être prélevée.',
    ),

    { text: 'Autorisation', bold: true, gap: 10 },
    ...wrap(
      `En signant ce mandat, vous autorisez ${creditor} et Stripe, son prestataire de ` +
        'paiement, à envoyer des instructions à votre banque pour débiter votre compte, ' +
        `et votre banque à débiter votre compte conformément aux instructions de ${creditor}. ` +
        'Vous bénéficiez du droit d’être remboursé par votre banque selon les conditions ' +
        'décrites dans la convention que vous avez passée avec elle. Une demande de ' +
        'remboursement doit être présentée dans les 8 semaines suivant la date de débit ' +
        'de votre compte pour un prélèvement autorisé. Vos droits concernant le présent ' +
        'mandat sont expliqués dans un document que vous pouvez obtenir auprès de votre banque.',
    ),

    { text: 'Signature', bold: true, gap: 10 },
    {
      text:
        `Signé électroniquement le ${parisTime(input.signedAt)} (heure de Paris), ` +
        'sur la page sécurisée de Stripe.',
    },
    ...(input.acceptance?.ipAddress
      ? [{ text: `Adresse IP : ${input.acceptance.ipAddress}` }]
      : []),
    ...(input.acceptance?.userAgent
      ? wrap(`Navigateur : ${input.acceptance.userAgent.slice(0, 240)}`)
      : []),
    { text: `Identifiant Stripe du mandat : ${input.stripeMandateId}` },

    {
      text:
        `Document établi par ${creditor} le ${parisTime(input.generatedAt ?? new Date())}. ` +
        'Le mandat fait foi tel qu’enregistré par Stripe.',
      size: 8,
      gap: 18,
    },
  ];
  return textPdf(lines);
}

export interface PdfLine {
  text: string;
  size?: number;
  bold?: boolean;
  /** Extra space above the line, in points. */
  gap?: number;
}

/** Greedy word wrap; ~95 characters is one line of 10 pt Helvetica between 50 pt margins. */
export function wrap(text: string, width = 95): PdfLine[] {
  const lines: PdfLine[] = [];
  let current = '';
  for (const word of text.split(/\s+/)) {
    if (current && current.length + 1 + word.length > width) {
      lines.push({ text: current });
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push({ text: current });
  return lines;
}

/**
 * A one-page A4 PDF of plain text lines in Helvetica.
 *
 * ponytail: single page, the two standard Helvetica faces, no images or tables — a
 * mandate fits. When facture B / the fiscal attestation get rendered (both wait on a
 * PDF, see commission-invoice.dto.ts), switch to a real PDF library for all three.
 */
export function textPdf(lines: PdfLine[]): Buffer {
  const ops = ['BT'];
  let y = 800;
  for (const line of lines) {
    const size = line.size ?? 10;
    y -= (line.gap ?? 0) + size * 1.45;
    if (y < 40) {
      throw new Error('textPdf: the content does not fit on one page.');
    }
    ops.push(
      `/${line.bold ? 'F2' : 'F1'} ${size} Tf`,
      `1 0 0 1 50 ${y.toFixed(1)} Tm`,
      `(${escapePdfText(toWinAnsi(line.text))}) Tj`,
    );
  }
  ops.push('ET');
  const content = ops.join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
      '/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];

  // Every character is single-byte from here on (`toWinAnsi`), so string length is the
  // byte offset the cross-reference table needs.
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/** Down to what Helvetica's WinAnsi encoding prints; anything else becomes `?`. */
export function toWinAnsi(text: string): string {
  return text
    .replace(/[   ]/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/€/g, 'EUR')
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
}

const escapePdfText = (text: string) => text.replace(/[\\()]/g, (char) => `\\${char}`);
