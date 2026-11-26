import { renderPayoutStatementPdf } from './payout-statement-document';

describe('renderPayoutStatementPdf', () => {
  it('draws the autofacture and its statement as a PDF', async () => {
    const pdf = await renderPayoutStatementPdf({
      number: 'LF-AF-2026-0001',
      issuedAt: '2026-11-26T09:00:00.000Z',
      paidAt: '2026-11-26T09:00:00.000Z',
      transferReference: 'LF VERSEMENT LF20260142',
      currency: 'EUR',
      netCents: 10_818,
      seller: {
        name: 'Awa Diallo EI',
        legalStatus: 'Entrepreneur individuel (micro-entreprise)',
        siren: '123456782',
        address: '1 rue de Lyon, 69007 Lyon',
        vatMention: 'TVA non applicable, article 293 B du CGI',
      },
      buyer: {
        name: 'Labs Food Batchcooking SAS',
        siren: null,
        address: null,
        sapDeclarationNumber: 'SAP100715036',
      },
      lines: [
        {
          bookingReference: 'LF-2026-0142',
          method: 'cesu',
          receivedAt: '2026-11-25T09:00:00.000Z',
          amountTtcCents: 15_000,
          vatRateBps: 1000,
          amountVatCents: 1364,
          amountHtCents: 13_636,
          commissionRateBps: 1500,
          commissionCents: 2045,
          cesuFeeBps: 1000,
          cesuFeeCents: 773,
          netCents: 10_818,
        },
      ],
    });

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(5000);
  });
});
