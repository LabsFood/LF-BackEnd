import { inflateSync } from 'node:zlib';

import { PDF_SPEC_TIMEOUT, textOf } from '../../common/pdf/pdf.test-helpers';
import { MandateDocumentInput, renderMandatePdf } from './sepa-mandate-document';

jest.setTimeout(PDF_SPEC_TIMEOUT);

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
      'CRÉANCIER',
      "Lab's Food",
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

  it('is a PDF/A-3b with its fonts and logo embedded', async () => {
    const raw = (await renderMandatePdf(INPUT)).toString('latin1');

    expect(raw.startsWith('%PDF-1.7')).toBe(true);
    expect(raw).toContain('<pdfaid:part>3</pdfaid:part>');
    expect(raw).toContain('<pdfaid:conformance>B</pdfaid:conformance>');
    expect(raw).toContain('/OutputIntents');
    expect(raw).toContain('/FontFile2');
    expect(raw).toContain('/Subtype /Image');
    // A standard font would be substituted by the reader, which PDF/A forbids.
    expect(raw).not.toMatch(/\/BaseFont \/Helvetica/);
  });

  it('prints no ligature, so every reader copies "préfinancé" whole', async () => {
    const raw = (await renderMandatePdf(INPUT)).toString('latin1');
    const cmaps = [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
      .map(([, body]) => {
        try {
          return inflateSync(Buffer.from(body, 'latin1')).toString('latin1');
        } catch {
          return '';
        }
      })
      .filter((stream) => stream.includes('beginbfrange'));

    // One per typeface: Montserrat regular and bold, Fraunces, DM Mono.
    expect(cmaps).toHaveLength(4);
    // A ligature is one glyph standing for several characters: `<0066 0069>` is "fi".
    expect(cmaps.join('\n')).not.toMatch(/<[0-9a-f]{4} [0-9a-f]{4}/);
  });

  it('leaves out the acceptance lines Stripe did not record', async () => {
    const text = textOf(
      await renderMandatePdf({ ...INPUT, ibanLast4: null, acceptance: null }),
    );

    expect(text).toContain('IBAN enregistré chez Stripe');
    expect(text).not.toContain('ADRESSE IP');
  });
});
