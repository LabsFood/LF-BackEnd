import { NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { FiscalAttestationsService } from './fiscal-attestations.service';

describe('FiscalAttestationsService', () => {
  let prisma: {
    user: { findUnique: jest.Mock };
    payment: { findMany: jest.Mock };
  };
  let users: { ensurePersistedFromClerk: jest.Mock };
  let service: FiscalAttestationsService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          fullName: 'Marie Client',
          email: 'marie@example.com',
        }),
      },
      payment: { findMany: jest.fn().mockResolvedValue([]) },
    };
    users = {
      ensurePersistedFromClerk: jest.fn().mockResolvedValue({ id: 'user-1' }),
    };
    service = new FiscalAttestationsService(
      prisma as unknown as PrismaService,
      users as unknown as UsersService,
    );
  });

  it('sums the eligible amounts of succeeded payments for the year', async () => {
    prisma.payment.findMany.mockResolvedValue([
      { amountTtc: 12_500, currency: 'EUR', taxCreditEligibleAmount: 12_500 },
      { amountTtc: 9_000, currency: 'EUR', taxCreditEligibleAmount: 9_000 },
    ]);

    await expect(service.summarizeForClerkUser('clerk_1', 2026)).resolves.toEqual({
      clientId: 'user-1',
      clientName: 'Marie Client',
      clientEmail: 'marie@example.com',
      year: 2026,
      eligibleAmountCents: 21_500,
      paymentsCount: 2,
      currency: 'EUR',
    });
  });

  it('falls back to amountTtc when no eligible amount was recorded', async () => {
    prisma.payment.findMany.mockResolvedValue([
      { amountTtc: 12_500, currency: 'EUR', taxCreditEligibleAmount: null },
    ]);

    const summary = await service.summarizeForClerkUser('clerk_1', 2026);
    expect(summary.eligibleAmountCents).toBe(12_500);
  });

  it('filters on succeeded payments settled inside the calendar year', async () => {
    await service.summarizeForClerkUser('clerk_1', 2026);

    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'succeeded',
          booking: { clientId: 'user-1' },
          paidAt: {
            gte: new Date('2026-01-01T00:00:00.000Z'),
            lt: new Date('2027-01-01T00:00:00.000Z'),
          },
        }),
      }),
    );
  });

  it('returns a zero total for a year with no payment', async () => {
    const summary = await service.summarizeForClerkUser('clerk_1', 2025);
    expect(summary).toMatchObject({
      eligibleAmountCents: 0,
      paymentsCount: 0,
      currency: 'EUR',
    });
  });

  it('404s on an unknown client in the admin detail route', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.summarizeForClientId('ghost', 2026)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('groups the admin listing per client, largest total first', async () => {
    prisma.payment.findMany.mockResolvedValue([
      {
        amountTtc: 10_000,
        currency: 'EUR',
        taxCreditEligibleAmount: 10_000,
        booking: { client: { id: 'user-1', fullName: 'Small', email: 's@example.com' } },
      },
      {
        amountTtc: 30_000,
        currency: 'EUR',
        taxCreditEligibleAmount: 30_000,
        booking: { client: { id: 'user-2', fullName: 'Big', email: 'b@example.com' } },
      },
      {
        amountTtc: 5_000,
        currency: 'EUR',
        taxCreditEligibleAmount: 5_000,
        booking: { client: { id: 'user-1', fullName: 'Small', email: 's@example.com' } },
      },
    ]);

    const rows = await service.summarizeAllClients(2026);

    expect(rows).toEqual([
      expect.objectContaining({
        clientId: 'user-2',
        eligibleAmountCents: 30_000,
        paymentsCount: 1,
      }),
      expect.objectContaining({
        clientId: 'user-1',
        eligibleAmountCents: 15_000,
        paymentsCount: 2,
      }),
    ]);
  });
});
