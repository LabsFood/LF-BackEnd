import { NotFoundException } from '@nestjs/common';

import { ChefPayoutsService } from './chef-payouts.service';

const HOUR = 3_600_000;

function setup() {
  const prisma = {
    payment: {
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn(),
      count: jest.fn(),
    },
    chefPayout: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      groupBy: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    commission: { updateMany: jest.fn() },
    platformSetting: { findUnique: jest.fn().mockResolvedValue(null) },
    chefProfile: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (tx: typeof prisma) => unknown) =>
    cb(prisma),
  );
  const users = {
    ensurePersistedFromClerk: jest.fn().mockResolvedValue({ id: 'admin-1' }),
  };
  const audit = { record: jest.fn() };
  const statements = {
    blockers: jest.fn().mockResolvedValue([]),
    issue: jest.fn().mockResolvedValue({ id: 'st-1', number: 'LF-AF-2026-0001' }),
    archive: jest.fn(),
    transmit: jest.fn(),
  };
  const service = new ChefPayoutsService(
    prisma as never,
    users as never,
    audit as never,
    statements as never,
  );
  return { prisma, users, audit, statements, service };
}

describe('ChefPayoutsService', () => {
  describe('sync', () => {
    it('freezes the net price of a received CESU payment, with the tier fee', async () => {
      const { prisma, service } = setup();
      const paidAt = new Date('2026-11-26T09:00:00Z');
      prisma.payment.findMany.mockResolvedValue([
        {
          id: 'pay-1',
          method: 'cesu',
          amountTtc: 10_000,
          paidAt,
          updatedAt: paidAt,
          booking: { chefProfileId: 'chef-1', chefProfile: { tier: 'tier_1' } },
          commission: { rateBps: 1500 },
        },
      ]);
      prisma.chefPayout.createMany.mockResolvedValue({ count: 1 });

      await service.sync();

      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'succeeded',
            chefPayout: null,
            commission: { collectionMethod: 'payout_withholding' },
          }),
        }),
      );
      expect(prisma.chefPayout.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            paymentId: 'pay-1',
            chefProfileId: 'chef-1',
            vatRateBps: 1000,
            amountHtCents: 9091,
            amountVatCents: 909,
            commissionCents: 1364,
            cesuFeeBps: 1000,
            cesuFeeCents: 773,
            netCents: 6954,
            receivedAt: paidAt,
          }),
        ],
        skipDuplicates: true,
      });
    });

    it('writes nothing when every received payment has its payout', async () => {
      const { prisma, service } = setup();
      await expect(service.sync()).resolves.toBe(0);
      expect(prisma.chefPayout.createMany).not.toHaveBeenCalled();
    });
  });

  describe('summary', () => {
    it('totals what is payable, the VAT, the margin and the late batch cookers', async () => {
      const { prisma, service } = setup();
      const now = new Date('2026-12-01T12:00:00Z');
      prisma.chefPayout.findMany.mockResolvedValue([
        {
          chefProfileId: 'a',
          netCents: 10_818,
          amountVatCents: 1364,
          commissionCents: 2045,
          cesuFeeCents: 773,
          receivedAt: new Date(now.getTime() - HOUR),
        },
        {
          chefProfileId: 'b',
          netCents: 17_600,
          amountVatCents: 2000,
          commissionCents: 2400,
          cesuFeeCents: 0,
          receivedAt: new Date('2026-11-25T10:00:00Z'),
        },
      ]);
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amountTtc: 12_000 } });
      prisma.platformSetting.findUnique.mockResolvedValue({
        value: { at: '2026-12-01T11:00:00Z', received: 2, matched: 2 },
      });

      const summary = await service.summary(now);

      expect(summary).toMatchObject({
        payableCents: 28_418,
        payableChefs: 2,
        vatCents: 3364,
        marginCents: 5218,
        awaitingCents: 12_000,
        lateChefs: 1,
        lateCents: 17_600,
        lastReconciliation: { at: '2026-12-01T11:00:00Z', received: 2, matched: 2 },
      });
    });
  });

  describe('markPaid', () => {
    it('marks the payable lines paid, collects the part kept back and issues the autofacture', async () => {
      const { prisma, audit, statements, service } = setup();
      const payouts = [
        { id: 'po-1', paymentId: 'pay-1', netCents: 10_818 },
        { id: 'po-2', paymentId: 'pay-2', netCents: 6955 },
      ];
      prisma.chefPayout.findMany.mockResolvedValue(payouts);
      prisma.chefPayout.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.markPaid(
        'clerk_admin',
        'chef-1',
        ['po-1', 'po-2'],
        'LF VERSEMENT',
      );

      expect(prisma.chefPayout.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: { in: ['po-1', 'po-2'] },
            chefProfileId: 'chef-1',
            status: 'payable',
          },
        }),
      );
      expect(prisma.chefPayout.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['po-1', 'po-2'] }, status: 'payable' },
          data: expect.objectContaining({
            status: 'paid',
            paidByUserId: 'admin-1',
            paidReference: 'LF VERSEMENT',
          }),
        }),
      );
      expect(prisma.commission.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            paymentId: { in: ['pay-1', 'pay-2'] },
            collectionMethod: 'payout_withholding',
          },
          data: expect.objectContaining({ status: 'collected' }),
        }),
      );
      expect(statements.issue).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          chefProfileId: 'chef-1',
          payouts,
          transferReference: 'LF VERSEMENT',
        }),
      );
      expect(statements.archive).toHaveBeenCalledWith('st-1');
      expect(statements.transmit).toHaveBeenCalledWith('st-1');
      expect(result).toMatchObject({
        paid: 2,
        netCents: 17_773,
        statementNumber: 'LF-AF-2026-0001',
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'payout.marked_paid' }),
      );
    });

    it('refuses before anything moves when no autofacture can be issued', async () => {
      const { prisma, statements, service } = setup();
      statements.blockers.mockResolvedValue(['siren', 'vatFranchise']);

      await expect(
        service.markPaid('clerk_admin', 'chef-1', ['po-1']),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'PAYOUT_STATEMENT_INCOMPLETE',
          missing: ['siren', 'vatFranchise'],
        }),
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses when nothing of this batch cooker is still payable', async () => {
      const { service } = setup();
      await expect(
        service.markPaid('clerk_admin', 'chef-1', ['po-9']),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
