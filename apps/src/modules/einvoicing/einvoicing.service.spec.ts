import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { B2BrouterProvider, toB2BrouterInvoice } from './b2brouter.provider';
import type { EInvoice } from './einvoice';
import { EInvoicingService } from './einvoicing.service';
import { eInvoiceFromPayoutStatement } from './from-payout-statement';

const INVOICE: EInvoice = {
  kind: 'self_billed',
  number: 'LF-AF-2026-0001',
  issueDate: '2026-11-26T10:00:00.000Z',
  currency: 'eur',
  seller: { name: 'Awa Diallo', siren: '123456789', address: '1 rue A, Lyon' },
  buyer: { name: 'Lab’s Food', siren: '987654321', address: 'Paris' },
  lines: [
    { description: 'Prestation', quantity: 1, unitPriceHtCents: 6954, vatRateBps: 0 },
  ],
  vatExemptionReason: 'TVA non applicable, article 293 B du CGI',
  notes: [],
};

const config = (values: Record<string, unknown>) =>
  ({
    get: (key: string) => values[key],
    getOrThrow: (key: string) => values[key],
  }) as unknown as ConfigService;

describe('EInvoicingService', () => {
  it('sends nothing when no platform is configured', async () => {
    const service = new EInvoicingService(config({ 'einvoicing.provider': 'none' }));

    await expect(service.submit(INVOICE)).resolves.toEqual(
      expect.objectContaining({ sent: false, status: 'disabled' }),
    );
    expect(service.enabled).toBe(false);
  });
});

describe('B2BrouterProvider', () => {
  const cfg = { env: 'sandbox' as const, apiKey: 'key', accountId: 'acc-1' };

  it('refuses to submit without a key or an account', async () => {
    const provider = new B2BrouterProvider({ ...cfg, apiKey: '' }, jest.fn());

    await expect(provider.submit(INVOICE)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('posts the invoice to the sandbox account and reads its id', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ invoice: { id: 42, state: 'new' } }),
    });
    const provider = new B2BrouterProvider(cfg, fetchImpl);

    const result = await provider.submit(INVOICE);

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api-staging.b2brouter.net/accounts/acc-1/invoices.json',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-B2B-API-Key': 'key' }),
      }),
    );
    expect(result).toEqual({
      sent: true,
      provider: 'b2brouter',
      externalId: '42',
      status: 'new',
    });
  });

  it('maps a self-billed invoice with euros and the exemption reason', () => {
    const body = toB2BrouterInvoice(INVOICE);

    expect(body).toEqual(
      expect.objectContaining({
        document_type_code: '389',
        currency: 'EUR',
        date: '2026-11-26',
        tax_exemption_reason: 'TVA non applicable, article 293 B du CGI',
      }),
    );
    expect((body.invoice_lines_attributes as { price: number }[])[0].price).toBe(69.54);
  });
});

describe('eInvoiceFromPayoutStatement', () => {
  it('turns each paid line into one net-price line without VAT', () => {
    const invoice = eInvoiceFromPayoutStatement({
      number: 'LF-AF-2026-0001',
      issuedAt: '2026-11-26T10:00:00.000Z',
      paidAt: '2026-11-26T10:00:00.000Z',
      transferReference: null,
      currency: 'eur',
      netCents: 6954,
      seller: {
        name: 'Awa Diallo',
        legalStatus: 'EI',
        siren: '123456789',
        address: 'Lyon',
        vatMention: 'TVA non applicable, article 293 B du CGI',
      },
      buyer: {
        name: 'Lab’s Food',
        siren: '987654321',
        address: 'Paris',
        sapDeclarationNumber: 'SAP100715036',
      },
      lines: [
        {
          bookingReference: 'BK-1',
          method: 'cesu',
          receivedAt: '2026-11-25T00:00:00.000Z',
          amountTtcCents: 10000,
          vatRateBps: 1000,
          amountVatCents: 909,
          amountHtCents: 9091,
          commissionRateBps: 1500,
          commissionCents: 1364,
          cesuFeeBps: 1000,
          cesuFeeCents: 773,
          netCents: 6954,
        },
      ],
    });

    expect(invoice.kind).toBe('self_billed');
    expect(invoice.lines).toEqual([
      expect.objectContaining({ unitPriceHtCents: 6954, vatRateBps: 0, quantity: 1 }),
    ]);
    expect(invoice.notes).toContain('Déclaration SAP SAP100715036');
  });
});
