import { AccountingExportService } from './accounting-export.service';

describe('AccountingExportService (temporary Indy export)', () => {
  it('lists Lab’s Food sales with their VAT, then autofactures without VAT', async () => {
    const prisma = {
      paymentInvoice: {
        findMany: jest.fn().mockResolvedValue([
          {
            snapshot: {
              issuer: 'sas',
              invoiceNumber: 'LF-CUS26-00001',
              issuedAt: '2026-11-26T10:00:00.000Z',
              amountTtcCents: 10_000,
              methodLabel: 'CESU',
              vat: { rateBps: 1000, htCents: 9091, vatCents: 909 },
              client: { name: 'Marie Dupont' },
            },
          },
        ]),
      },
      payoutStatement: {
        findMany: jest.fn().mockResolvedValue([
          {
            snapshot: {
              number: 'LF-AF-2026-0001',
              issuedAt: '2026-11-27T10:00:00.000Z',
              netCents: 6954,
              seller: { name: 'Awa Diallo' },
            },
          },
        ]),
      },
    };
    const service = new AccountingExportService(prisma as never);
    const from = new Date('2026-11-01');
    const to = new Date('2026-12-01');

    const lines = await service.lines({ from, to });

    expect(prisma.paymentInvoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          issuedAt: { gte: from, lt: to },
          snapshot: { path: ['issuer'], equals: 'sas' },
        },
      }),
    );
    expect(lines).toEqual([
      {
        kind: 'vente',
        number: 'LF-CUS26-00001',
        issuedAt: '2026-11-26T10:00:00.000Z',
        counterparty: 'Marie Dupont',
        method: 'CESU',
        htCents: 9091,
        vatRateBps: 1000,
        vatCents: 909,
        ttcCents: 10_000,
      },
      {
        kind: 'achat',
        number: 'LF-AF-2026-0001',
        issuedAt: '2026-11-27T10:00:00.000Z',
        counterparty: 'Awa Diallo',
        method: null,
        htCents: 6954,
        vatRateBps: 0,
        vatCents: 0,
        ttcCents: 6954,
      },
    ]);
  });
});
