import { textOf } from '../../common/pdf/pdf.test-helpers';
import {
  formatMoney,
  PaymentInvoiceSnapshot,
  renderPaymentInvoicePdf,
} from './payment-invoice-document';

const SNAPSHOT: PaymentInvoiceSnapshot = {
  invoiceNumber: 'LF-CUS26-00007',
  issuedAt: '2026-11-02T10:00:00.000Z',
  paidAt: '2026-11-02T10:00:00.000Z',
  currency: 'EUR',
  amountTtcCents: 20_000,
  lines: [
    { label: 'Batch cooking 4 repas', amountCents: 18_500 },
    { label: 'Courses', amountCents: 1_500 },
  ],
  seller: {
    displayName: 'Chef Amina',
    city: 'Lyon',
    sapDeclarationNumber: 'SAP123456789',
  },
  client: { name: 'Marie Dupont', email: 'marie@example.com' },
  booking: {
    reference: 'LF-2026-0042',
    address: '12 rue de la Paix, 69002 Lyon',
    startsAt: '2026-11-05T09:00:00.000Z',
  },
};

describe('formatMoney', () => {
  it('writes euros the French way, with plain spaces the embedded face can print', () => {
    expect(formatMoney(20_000, 'EUR')).toBe('200,00 €');
    expect(formatMoney(1_234_560, 'EUR')).toBe('12 345,60 €');
    expect(formatMoney(5, 'EUR')).toBe('0,05 €');
  });
});

describe('renderPaymentInvoicePdf', () => {
  it('carries the number, both parties, the lines and the total', async () => {
    const pdf = await renderPaymentInvoicePdf(SNAPSHOT);
    const text = textOf(pdf);

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    for (const fact of [
      'LF-CUS26-00007',
      'Chef Amina',
      'SAP123456789',
      'Marie Dupont',
      'LF-2026-0042',
      // The brand panel sets its labels in capitals.
      'BATCH COOKING 4 REPAS 185,00 €',
      'TOTAL PAYÉ 200,00 €',
      '200,00 €',
      "Lab's Food",
    ]) {
      expect(text).toContain(fact);
    }
  });

  it('draws an invoice with no SAP number, address or reference', async () => {
    const text = textOf(
      await renderPaymentInvoicePdf({
        ...SNAPSHOT,
        seller: { ...SNAPSHOT.seller, city: null, sapDeclarationNumber: null },
        booking: { ...SNAPSHOT.booking, reference: null, address: null },
      }),
    );

    expect(text).toContain('LF-CUS26-00007');
    expect(text).not.toContain('SAP');
  });
});
