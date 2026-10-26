import { renderMandatePdf, textPdf, toWinAnsi, wrap } from './sepa-mandate-document';

/** Every byte offset the cross-reference table claims, checked against the file. */
function assertXrefConsistent(pdf: Buffer) {
  const text = pdf.toString('latin1');
  const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)![1]);
  expect(text.slice(startxref, startxref + 4)).toBe('xref');
  const entries = text
    .slice(startxref)
    .split('\n')
    .filter((line) => / 00000 n $/.test(line))
    .map((line) => Number(line.slice(0, 10)));
  entries.forEach((offset, index) => {
    expect(text.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(
      `${index + 1} 0 obj`,
    );
  });
  const length = Number(/\/Length (\d+)/.exec(text)![1]);
  const stream = text.indexOf('stream\n') + 'stream\n'.length;
  expect(text.slice(stream + length, stream + length + '\nendstream'.length)).toBe(
    '\nendstream',
  );
}

describe('textPdf', () => {
  it('writes a PDF whose cross-reference table points at every object', () => {
    const pdf = textPdf([{ text: 'Bonjour', bold: true }, { text: 'Deuxième ligne' }]);

    expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    assertXrefConsistent(pdf);
  });

  it('escapes what would end a PDF string early', () => {
    const pdf = textPdf([{ text: 'a (b) c\\d' }]).toString('latin1');

    expect(pdf).toContain('(a \\(b\\) c\\\\d) Tj');
  });

  it('keeps French accents as single WinAnsi bytes', () => {
    const pdf = textPdf([{ text: 'Créancier é' }]);

    expect(pdf.includes(Buffer.from([0xe9]))).toBe(true);
    assertXrefConsistent(pdf);
  });

  it('refuses content that would run off the page rather than truncate it', () => {
    const lines = Array.from({ length: 80 }, (_, i) => ({ text: `ligne ${i}` }));

    expect(() => textPdf(lines)).toThrow(/does not fit/);
  });
});

describe('toWinAnsi', () => {
  it('maps typographic punctuation and drops what Helvetica cannot print', () => {
    expect(toWinAnsi('d’être — 12 € … 漢')).toBe("d'être - 12 EUR ... ?");
  });
});

describe('wrap', () => {
  it('breaks on words, never inside one', () => {
    const lines = wrap('aaa bbb ccc ddd', 7).map((line) => line.text);

    expect(lines).toEqual(['aaa bbb', 'ccc ddd']);
  });
});

describe('renderMandatePdf', () => {
  it('carries the mandate reference, the masked IBAN and the signature evidence', () => {
    const pdf = renderMandatePdf({
      reference: 'RUM-2026-001',
      stripeMandateId: 'mandate_1',
      creditorName: "LAB'S FOOD",
      debtorName: 'Marie Dupont',
      debtorEmail: 'marie@example.com',
      ibanLast4: '3000',
      signedAt: new Date('2026-10-26T09:30:00.000Z'),
      acceptance: { ipAddress: '203.0.113.7', userAgent: 'Mozilla/5.0' },
      generatedAt: new Date('2026-10-26T09:31:00.000Z'),
    });
    const text = pdf.toString('latin1');

    for (const fact of [
      'RUM-2026-001',
      'mandate_1',
      'Marie Dupont',
      'IBAN se terminant par 3000',
      '203.0.113.7',
      '8 semaines',
    ]) {
      expect(text).toContain(fact);
    }
    assertXrefConsistent(pdf);
  });
});
