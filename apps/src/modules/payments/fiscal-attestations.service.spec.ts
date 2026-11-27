import { NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { FiscalAttestationsService } from './fiscal-attestations.service';

const CLIENT = { id: 'user-1', fullName: 'Marie Client', email: 'marie@example.com' };

/** A succeeded payment of `amount` to `chef`, by `client`. */
function payment(
  amount: number,
  chef: {
    id: string;
    displayName: string;
    sapProfile?: {
      declarationType: string;
      novaCode: string | null;
      cooperativeName: string | null;
    } | null;
  },
  client = CLIENT,
  paid: { method?: string; medium?: 'ecesu' | 'cesu_paper' } = {},
) {
  return {
    amountTtc: amount,
    currency: 'EUR',
    taxCreditEligibleAmount: amount,
    method: paid.method ?? 'cb',
    cesuSettlement: paid.medium ? { medium: paid.medium } : null,
    booking: { client, chefProfile: { sapProfile: null, ...chef } },
  };
}

const ECESU = { method: 'cesu', medium: 'ecesu' } as const;
const PAPER_CESU = { method: 'cesu', medium: 'cesu_paper' } as const;

const CHEF_A = {
  id: 'chef-a',
  displayName: 'Chef Marie D.',
  sapProfile: {
    declarationType: 'type_a_nova',
    novaCode: 'SAP123456789',
    cooperativeName: null,
  },
};
const CHEF_B = {
  id: 'chef-b',
  displayName: 'Chef Paul B.',
  sapProfile: {
    declarationType: 'type_b_cooperative',
    novaCode: null,
    cooperativeName: 'Coop SAP',
  },
};
const CHEF_UNDECLARED = { id: 'chef-c', displayName: 'Chef Sans SAP', sapProfile: null };

describe('FiscalAttestationsService', () => {
  let prisma: {
    user: { findUnique: jest.Mock };
    payment: { findMany: jest.Mock };
  };
  let users: { ensurePersistedFromClerk: jest.Mock };
  let service: FiscalAttestationsService;

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(CLIENT) },
      payment: { findMany: jest.fn().mockResolvedValue([]) },
    };
    users = { ensurePersistedFromClerk: jest.fn().mockResolvedValue({ id: 'user-1' }) };
    service = new FiscalAttestationsService(
      prisma as unknown as PrismaService,
      users as unknown as UsersService,
    );
  });

  it('issues one provider entry per chef, never a merged total', async () => {
    prisma.payment.findMany.mockResolvedValue([
      payment(10_000, CHEF_A),
      payment(30_000, CHEF_B),
      payment(5_000, CHEF_A),
    ]);

    const result = await service.summarizeForClerkUser('clerk_1', 2026);

    expect(result.providers).toHaveLength(2);
    // Largest first: chef B (30 000) before chef A (15 000).
    expect(result.providers[0]).toMatchObject({
      chefProfileId: 'chef-b',
      eligibleAmountCents: 30_000,
      paymentsCount: 1,
    });
    expect(result.providers[1]).toMatchObject({
      chefProfileId: 'chef-a',
      eligibleAmountCents: 15_000,
      paymentsCount: 2,
    });
  });

  it('is issued by Lab’s Food under the SAS SAP declaration, whoever cooked', async () => {
    const saved = { ...process.env };
    process.env.SAP_DECLARATION_NUMBER = 'SAP100715036';
    process.env.SAS_LEGAL_NAME = 'Lab’s Food Batchcooking SAS';
    process.env.SAS_SIREN = '131895203';
    prisma.payment.findMany.mockResolvedValue([
      payment(10_000, CHEF_A),
      payment(10_000, CHEF_B),
    ]);

    try {
      const result = await service.summarizeForClerkUser('clerk_1', 2026);

      expect(result.issuer).toEqual({
        name: 'Lab’s Food',
        legalName: 'Lab’s Food Batchcooking SAS',
        siren: '131895203',
        address: saved.SAS_ADDRESS?.trim() || null,
        sapDeclarationNumber: 'SAP100715036',
      });
    } finally {
      process.env = saved;
    }
  });

  it('keeps each chef own SAP declaration on their entry, for the dossier check', async () => {
    prisma.payment.findMany.mockResolvedValue([
      payment(10_000, CHEF_A),
      payment(10_000, CHEF_B),
    ]);

    const { providers } = await service.summarizeForClerkUser('clerk_1', 2026);
    const a = providers.find((p) => p.chefProfileId === 'chef-a');
    const b = providers.find((p) => p.chefProfileId === 'chef-b');

    expect(a).toMatchObject({
      sapDeclared: true,
      declarationType: 'type_a_nova',
      novaCode: 'SAP123456789',
      cooperativeName: null,
    });
    expect(b).toMatchObject({
      sapDeclared: true,
      declarationType: 'type_b_cooperative',
      novaCode: null,
      cooperativeName: 'Coop SAP',
    });
  });

  it('flags a chef with no SAP declaration of their own', async () => {
    prisma.payment.findMany.mockResolvedValue([payment(10_000, CHEF_UNDECLARED)]);

    const { providers } = await service.summarizeForClerkUser('clerk_1', 2026);

    expect(providers[0]).toMatchObject({
      sapDeclared: false,
      declarationType: null,
      novaCode: null,
    });
  });

  it('reports client-level totals as the sum of the providers', async () => {
    prisma.payment.findMany.mockResolvedValue([
      payment(10_000, CHEF_A),
      payment(30_000, CHEF_B),
    ]);

    const result = await service.summarizeForClerkUser('clerk_1', 2026);

    expect(result).toMatchObject({
      clientId: 'user-1',
      clientName: 'Marie Client',
      clientEmail: 'marie@example.com',
      year: 2026,
      eligibleAmountCents: 40_000,
      paymentsCount: 2,
      currency: 'EUR',
    });
  });

  it('falls back to amountTtc when no eligible amount was recorded', async () => {
    prisma.payment.findMany.mockResolvedValue([
      { ...payment(12_500, CHEF_A), taxCreditEligibleAmount: null },
    ]);

    const result = await service.summarizeForClerkUser('clerk_1', 2026);

    expect(result.eligibleAmountCents).toBe(12_500);
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

  it('returns an empty provider list for a year with no payment', async () => {
    const result = await service.summarizeForClerkUser('clerk_1', 2025);

    expect(result).toMatchObject({
      eligibleAmountCents: 0,
      paymentsCount: 0,
      currency: 'EUR',
      providers: [],
    });
  });

  describe('what the platform itself attests', () => {
    it('counts a card payment to a type A chef in full', async () => {
      prisma.payment.findMany.mockResolvedValue([payment(10_000, CHEF_A)]);

      const result = await service.summarizeForClerkUser('clerk_1', 2026);

      expect(result.eligibleAmountCents).toBe(10_000);
      expect(result.platformAttestedAmountCents).toBe(10_000);
      expect(result.providers[0].notes).toEqual([]);
    });

    it('attests paper CESU but not e-CESU', async () => {
      // Both are prefinanced titres from the same issuers; only the electronic circuit is
      // excluded today. See the accountant question logged against `isPlatformAttestable`.
      prisma.payment.findMany.mockResolvedValue([
        payment(4_000, CHEF_A, CLIENT, PAPER_CESU),
        payment(6_000, CHEF_A, CLIENT, ECESU),
      ]);

      const result = await service.summarizeForClerkUser('clerk_1', 2026);

      expect(result.eligibleAmountCents).toBe(10_000);
      expect(result.platformAttestedAmountCents).toBe(4_000);
    });

    it('tells the client who attests the e-CESU part', async () => {
      prisma.payment.findMany.mockResolvedValue([payment(6_000, CHEF_A, CLIENT, ECESU)]);

      const result = await service.summarizeForClerkUser('clerk_1', 2026);

      expect(result.providers[0].notes).toEqual([
        'Part réglée en e-CESU — attestation délivrée par votre émetteur.',
      ]);
    });

    it('attests a type B chef too: the SAS invoiced the household, not the cooperative', async () => {
      prisma.payment.findMany.mockResolvedValue([payment(30_000, CHEF_B)]);

      const result = await service.summarizeForClerkUser('clerk_1', 2026);

      expect(result.eligibleAmountCents).toBe(30_000);
      expect(result.platformAttestedAmountCents).toBe(30_000);
      expect(result.providers[0].notes).toEqual([]);
    });

    it('lists the payment methods used with each provider', async () => {
      prisma.payment.findMany.mockResolvedValue([
        payment(4_000, CHEF_A),
        payment(6_000, CHEF_A, CLIENT, ECESU),
      ]);

      const result = await service.summarizeForClerkUser('clerk_1', 2026);

      expect(result.providers[0].paymentMethods).toEqual(['cb', 'cesu']);
    });

    it('reads the method and the CESU medium from the query', async () => {
      await service.summarizeForClerkUser('clerk_1', 2026);

      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            method: true,
            cesuSettlement: { select: { medium: true } },
          }),
        }),
      );
    });
  });

  it('404s on an unknown client in the admin detail route', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.summarizeForClientId('ghost', 2026)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('groups the admin listing per client, largest total first', async () => {
    const other = { id: 'user-2', fullName: 'Big', email: 'big@example.com' };
    prisma.payment.findMany.mockResolvedValue([
      payment(10_000, CHEF_A),
      payment(30_000, CHEF_B, other),
      payment(5_000, CHEF_B),
    ]);

    const rows = await service.summarizeAllClients(2026);

    expect(rows.map((r) => r.clientId)).toEqual(['user-2', 'user-1']);
    expect(rows[0]).toMatchObject({ eligibleAmountCents: 30_000, paymentsCount: 1 });
    expect(rows[1]).toMatchObject({ eligibleAmountCents: 15_000, paymentsCount: 2 });
    // One attestation per client, broken down by batch cooker.
    expect(rows[1].providers).toHaveLength(2);
  });
});
