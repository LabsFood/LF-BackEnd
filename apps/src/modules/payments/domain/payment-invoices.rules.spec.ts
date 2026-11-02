import {
  formatInvoiceNumber,
  invoiceLines,
  invoiceYear,
  type InvoiceBookingFacts,
} from './payment-invoices.rules';

const BOOKING: InvoiceBookingFacts = {
  offerName: 'Batch cooking 4 repas',
  amountTtcCents: 20_000,
  shoppingFeeCents: 1_500,
  extraPersonsCents: 2_000,
  extraMealsCents: 3_000,
};

const sum = (lines: { amountCents: number }[]) =>
  lines.reduce((total, line) => total + line.amountCents, 0);

describe('formatInvoiceNumber', () => {
  it('numbers <prefix>-<year>-NNNN, padded to four digits', () => {
    expect(formatInvoiceNumber('LF-FAC', 2026, 1)).toBe('LF-FAC-2026-0001');
    expect(formatInvoiceNumber('LF-FAC', 2026, 372)).toBe('LF-FAC-2026-0372');
  });

  it('keeps counting past 9999 instead of truncating', () => {
    expect(formatInvoiceNumber('LF-FAC', 2026, 12_345)).toBe('LF-FAC-2026-12345');
  });

  it('refuses a sequence that is not a positive integer', () => {
    expect(() => formatInvoiceNumber('LF-FAC', 2026, 0)).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'INVOICE_SEQUENCE_INVALID' }),
      }),
    );
    expect(() => formatInvoiceNumber('LF-FAC', 2026, 1.5)).toThrow();
  });
});

describe('invoiceYear', () => {
  it('reads the year in Paris, not in UTC', () => {
    // 22:30Z on 31 Dec is 23:30 in Paris: still the old year.
    expect(invoiceYear(new Date('2026-12-31T22:30:00Z'))).toBe(2026);
    // 23:30Z on 31 Dec is 00:30 on 1 Jan in Paris: the invoice belongs to the new year.
    expect(invoiceYear(new Date('2026-12-31T23:30:00Z'))).toBe(2027);
  });
});

describe('invoiceLines', () => {
  it('splits a fully paid booking into the base and each extra that applies', () => {
    const lines = invoiceLines(BOOKING, 20_000);

    expect(lines).toEqual([
      { label: 'Batch cooking 4 repas', amountCents: 13_500 },
      { label: 'Courses', amountCents: 1_500 },
      { label: 'Adultes supplémentaires', amountCents: 2_000 },
      { label: 'Plats supplémentaires', amountCents: 3_000 },
    ]);
    expect(sum(lines)).toBe(20_000);
  });

  it('leaves out an extra that is zero', () => {
    const lines = invoiceLines(
      { ...BOOKING, shoppingFeeCents: 0, extraPersonsCents: 0, extraMealsCents: 0 },
      20_000,
    );

    expect(lines).toEqual([{ label: 'Batch cooking 4 repas', amountCents: 20_000 }]);
  });

  it('bills a part payment as one line: the split of the booking is not its to carry', () => {
    const lines = invoiceLines(BOOKING, 8_000);

    expect(lines).toEqual([
      { label: 'Règlement partiel — Batch cooking 4 repas', amountCents: 8_000 },
    ]);
  });

  it('falls back to one line when the extras exceed the total (inconsistent data)', () => {
    const lines = invoiceLines({ ...BOOKING, extraMealsCents: 30_000 }, 20_000);

    expect(lines).toEqual([{ label: 'Batch cooking 4 repas', amountCents: 20_000 }]);
  });

  it('always adds up to what was paid', () => {
    for (const paid of [1, 8_000, 19_999, 20_000]) {
      expect(sum(invoiceLines(BOOKING, paid))).toBe(paid);
    }
  });

  it('refuses an amount that is not a positive integer of cents', () => {
    expect(() => invoiceLines(BOOKING, 0)).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'INVOICE_AMOUNT_INVALID' }),
      }),
    );
    expect(() => invoiceLines(BOOKING, 10.5)).toThrow();
  });
});
