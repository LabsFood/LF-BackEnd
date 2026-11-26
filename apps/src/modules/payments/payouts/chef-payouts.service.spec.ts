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
      findFirst: jest.fn().mockResolvedValue(null),
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
    requireOwnChefProfile: jest.fn().mockResolvedValue({ id: 'chef-own' }),
  };
  const audit = { record: jest.fn() };
  const statements = {
    blockers: jest.fn().mockResolvedValue([]),
    issue: jest.fn().mockResolvedValue({ id: 'st-1', number: 'LF-AF-2026-0001' }),
    archive: jest.fn(),
    transmit: jest.fn(),
  };
  const transfers = { create: jest.fn().mockResolvedValue({ id: 'tr_1' }) };
  const stripe = { configured: true, getClient: () => ({ transfers }) };
  const invoices = { issueNow: jest.fn() };
  const service = new ChefPayoutsService(
    prisma as never,
    users as never,
    audit as never,
    statements as never,
    stripe as never,
    invoices as never,
  );
  return { prisma, users, audit, statements, stripe, transfers, invoices, service };
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

  describe('myPayouts', () => {
    it("reads only the caller's own chef profile", async () => {
      const { prisma, users, service } = setup();
      prisma.chefProfile.findUnique.mockResolvedValue({
        id: 'chef-own',
        displayName: 'Awa',
        city: 'Lyon',
        tier: 'standard',
        sepaMandate: null,
      });

      const card = await service.myPayouts('clerk_chef', 'paid', {});

      expect(users.requireOwnChefProfile).toHaveBeenCalledWith('clerk_chef');
      expect(prisma.chefProfile.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'chef-own' } }),
      );
      expect(card.chef.chefProfileId).toBe('chef-own');
    });
  });

  describe('card at net price', () => {
    const CARD = {
      id: 'po-c',
      paymentId: 'pay-c',
      method: 'cb',
      netCents: 7650,
      chefProfileId: 'chef-1',
      payment: {
        stripeChargeId: 'ch_1',
        currency: 'EUR',
        bookingId: 'bk-1',
        booking: {},
      },
      chefProfile: { stripeAccountId: 'acct_chef' },
    };

    it('transfers the net of a card line to the Stripe account, once per line', async () => {
      const { prisma, transfers, service } = setup();
      prisma.chefPayout.findMany.mockResolvedValue([CARD]);
      prisma.chefPayout.updateMany.mockResolvedValue({ count: 1 });

      await service.markPaid('clerk_admin', 'chef-1', ['po-c']);

      expect(transfers.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 7650,
          currency: 'eur',
          destination: 'acct_chef',
          source_transaction: 'ch_1',
          transfer_group: 'bk-1',
        }),
        { idempotencyKey: 'chef-payout-po-c' },
      );
      expect(prisma.chefPayout.updateMany).toHaveBeenCalledWith({
        where: { id: 'po-c', status: 'payable' },
        data: expect.objectContaining({ status: 'paid', paidReference: 'tr_1' }),
      });
    });

    it('pays a card right after the charge, without an admin', async () => {
      const { prisma, transfers, audit, service } = setup();
      prisma.chefPayout.findFirst.mockResolvedValue(CARD);
      prisma.chefPayout.findMany.mockResolvedValue([CARD]);
      prisma.chefPayout.updateMany.mockResolvedValue({ count: 1 });

      await service.payCardNow('pay-c');

      expect(transfers.create).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ actorType: 'system', actorUserId: null }),
      );
    });

    it('leaves the card line to pay when the autofacture cannot be issued yet', async () => {
      const { prisma, statements, transfers, service } = setup();
      prisma.chefPayout.findFirst.mockResolvedValue(CARD);
      statements.blockers.mockResolvedValue(['siren']);

      await service.payCardNow('pay-c');

      expect(transfers.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
