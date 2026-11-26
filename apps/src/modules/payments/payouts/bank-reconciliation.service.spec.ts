import { BankReconciliationService } from './bank-reconciliation.service';
import * as bankFeed from '../cesu-reconciliation/bank-feed';

function setup() {
  const prisma = {
    bankCredit: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
    payment: { findMany: jest.fn().mockResolvedValue([]) },
    platformSetting: { upsert: jest.fn() },
  };
  const users = {
    ensurePersistedFromClerk: jest.fn().mockResolvedValue({ id: 'admin-1' }),
  };
  const cesu = { settleFromBank: jest.fn() };
  const payouts = { sync: jest.fn().mockResolvedValue(0) };
  const service = new BankReconciliationService(
    prisma as never,
    users as never,
    cesu as never,
    payouts as never,
  );
  return { prisma, cesu, payouts, service };
}

describe('BankReconciliationService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reads nothing without bank credentials, and says so', async () => {
    jest.spyOn(bankFeed, 'bankFeedConfig').mockReturnValue(null);
    const fetchSpy = jest.spyOn(bankFeed, 'fetchCredits');
    const { prisma, payouts, service } = setup();

    const run = await service.run('clerk_admin', new Date('2026-11-26T08:00:00Z'));

    expect(run).toEqual({
      at: '2026-11-26T08:00:00.000Z',
      configured: false,
      received: 0,
      matched: 0,
      exceptions: 0,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(payouts.sync).toHaveBeenCalled();
    expect(prisma.platformSetting.upsert).toHaveBeenCalled();
  });

  it('settles the declaration a transfer pays and keeps the rest as exceptions', async () => {
    jest
      .spyOn(bankFeed, 'bankFeedConfig')
      .mockReturnValue({ secretId: 's', secretKey: 'k', accountId: 'a' });
    jest.spyOn(bankFeed, 'fetchCredits').mockResolvedValue([
      {
        transactionId: 'tx-1',
        bookedOn: '2026-11-25',
        amountCents: 10_000,
        label: 'CRCESU LF-2026-0142',
      },
      {
        transactionId: 'tx-2',
        bookedOn: '2026-11-25',
        amountCents: 4_200,
        label: 'VIR INCONNU',
      },
      {
        transactionId: 'tx-old',
        bookedOn: '2026-11-24',
        amountCents: 5_000,
        label: 'deja vu',
      },
    ]);
    const { prisma, cesu, service } = setup();
    prisma.bankCredit.findMany.mockResolvedValue([{ transactionId: 'tx-old' }]);
    prisma.payment.findMany.mockResolvedValue([
      { id: 'pay-1', amountTtc: 10_000, booking: { reference: 'LF-2026-0142' } },
    ]);

    const run = await service.run('clerk_admin');

    expect(cesu.settleFromBank).toHaveBeenCalledWith('pay-1', 'admin-1', 'tx-1');
    expect(prisma.bankCredit.create).toHaveBeenCalledTimes(2);
    expect(prisma.bankCredit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        transactionId: 'tx-1',
        outcome: 'matched',
        paymentId: 'pay-1',
      }),
    });
    expect(prisma.bankCredit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        transactionId: 'tx-2',
        outcome: 'unidentified',
        paymentId: null,
      }),
    });
    expect(run).toMatchObject({
      configured: true,
      received: 2,
      matched: 1,
      exceptions: 1,
    });
  });
});
