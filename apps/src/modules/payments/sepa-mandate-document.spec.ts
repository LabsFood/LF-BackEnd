import { inflateSync } from 'node:zlib';

import { MandateDocumentInput, renderMandatePdf } from './sepa-mandate-document';

/**
 * The text a reader sees, back out of the PDF: every content stream inflated, every
 * hex string PDFKit writes decoded from WinAnsi. Kerning splits words inside a `TJ`
 * array, so the pieces are joined before the lines are.
 */
function textOf(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  const lines: string[] = [];
  for (const [, body] of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(body, 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    for (const [, array] of content.matchAll(/\[(.*?)\] TJ/g)) {
      lines.push(
        [...array.matchAll(/<([0-9a-f]*)>/g)]
          .map(([, hex]) => Buffer.from(hex, 'hex').toString('latin1'))
          .join(''),
      );
    }
  }
  return lines.join(' ');
}

const INPUT: MandateDocumentInput = {
  reference: 'RUM-2026-001',
  stripeMandateId: 'mandate_1',
  creditorName: "LAB'S FOOD",
  debtorName: 'Marie Dupont',
  debtorEmail: 'marie@example.com',
  ibanLast4: '3000',
  signedAt: new Date('2026-10-26T09:30:00.000Z'),
  acceptance: { ipAddress: '203.0.113.7', userAgent: 'Mozilla/5.0' },
  generatedAt: new Date('2026-10-26T09:31:00.000Z'),
};

describe('renderMandatePdf', () => {
  it('carries the mandate reference, the masked IBAN and the signature evidence', async () => {
    const pdf = await renderMandatePdf(INPUT);
    const text = textOf(pdf);

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    for (const fact of [
      'RUM-2026-001',
      'mandate_1',
      'Marie Dupont',
      'IBAN se terminant par 3000',
      '203.0.113.7',
      '8 semaines',
      'Créancier',
    ]) {
      expect(text).toContain(fact);
    }
  });

  it('prints the signature time in Paris time', async () => {
    const text = textOf(await renderMandatePdf(INPUT));

    // 09:30 UTC is 10:30 in Paris on 26 October 2026 (winter time from the 25th).
    expect(text).toContain('26 octobre 2026');
    expect(text).toContain('10:30');
  });

  it('leaves out the acceptance lines Stripe did not record', async () => {
    const text = textOf(
      await renderMandatePdf({ ...INPUT, ibanLast4: null, acceptance: null }),
    );

    expect(text).toContain('IBAN enregistré chez Stripe');
    expect(text).not.toContain('Adresse IP');
  });
});
