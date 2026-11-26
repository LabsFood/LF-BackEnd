import { PayoutStatementsService } from './payout-statements.service';

const SNAPSHOT = {
  number: 'LF-AF-2026-0001',
  issuedAt: '2026-11-26T10:00:00.000Z',
  paidAt: '2026-11-26T10:00:00.000Z',
  transferReference: null,
  currency: 'EUR',
  netCents: 6954,
  seller: {
    name: 'Awa Diallo',
    legalStatus: 'EI',
    siren: '123456789',
    address: 'Lyon',
    vatMention: 'TVA non applicable, article 293 B du CGI',
  },
  buyer: { name: 'Lab’s Food', siren: null, address: null, sapDeclarationNumber: null },
  lines: [],
};

function setup(enabled: boolean) {
  const prisma = {
    payoutStatement: {
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ snapshot: SNAPSHOT, einvoiceSentAt: null }),
      findMany: jest.fn().mockResolvedValue([{ id: 'st-1' }, { id: 'st-2' }]),
      update: jest.fn(),
    },
  };
  const einvoicing = {
    enabled,
    submit: jest.fn().mockResolvedValue({
      sent: true,
      provider: 'b2brouter',
      externalId: '42',
      status: 'new',
    }),
  };
  const service = new PayoutStatementsService(
    prisma as never,
    {} as never,
    {} as never,
    einvoicing as never,
    { get: (_key: string, fallback: unknown) => fallback } as never,
  );
  return { prisma, einvoicing, service };
}

describe('PayoutStatementsService e-invoicing', () => {
  it('sends nothing while no platform is configured', async () => {
    const { prisma, einvoicing, service } = setup(false);

    await service.transmit('st-1');
    await expect(service.transmitPending()).resolves.toBe(0);

    expect(einvoicing.submit).not.toHaveBeenCalled();
    expect(prisma.payoutStatement.findMany).not.toHaveBeenCalled();
  });

  it('records the platform id and status once the autofacture is accepted', async () => {
    const { prisma, einvoicing, service } = setup(true);

    await service.transmit('st-1');

    expect(einvoicing.submit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'self_billed', number: 'LF-AF-2026-0001' }),
    );
    expect(prisma.payoutStatement.update).toHaveBeenCalledWith({
      where: { id: 'st-1' },
      data: expect.objectContaining({
        einvoiceProvider: 'b2brouter',
        einvoiceExternalId: '42',
        einvoiceStatus: 'new',
        einvoiceSentAt: expect.any(Date),
      }),
    });
  });

  it('never sends an autofacture twice', async () => {
    const { prisma, einvoicing, service } = setup(true);
    prisma.payoutStatement.findUniqueOrThrow.mockResolvedValue({
      snapshot: SNAPSHOT,
      einvoiceSentAt: new Date(),
    });

    await service.transmit('st-1');

    expect(einvoicing.submit).not.toHaveBeenCalled();
  });

  it('keeps a refused autofacture pending for the next hourly run', async () => {
    const { prisma, einvoicing, service } = setup(true);
    einvoicing.submit.mockRejectedValue(new Error('HTTP 422'));

    await expect(service.transmitPending()).resolves.toBe(2);

    expect(prisma.payoutStatement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { einvoiceSentAt: null } }),
    );
    expect(prisma.payoutStatement.update).not.toHaveBeenCalled();
  });
});
