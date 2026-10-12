import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { FiscalAttestationDto, FiscalAttestationProviderDto } from './dto/payment.dto';

/** Payment row shape the aggregation needs: amounts plus who was paid, by whom. */
type AttestationPayment = {
  amountTtc: number;
  currency: string;
  taxCreditEligibleAmount: number | null;
  booking: {
    client: { id: string; fullName: string | null; email: string };
    chefProfile: {
      id: string;
      displayName: string;
      sapProfile: {
        declarationType: FiscalAttestationProviderDto['declarationType'];
        novaCode: string | null;
        cooperativeName: string | null;
      } | null;
    };
  };
};

/**
 * Yearly totals backing the "attestation fiscale" a client files for the 50 %
 * "service à la personne" credit.
 *
 * **The chef is the declared provider (prestataire)**, so an attestation is issued per
 * chef, carrying that chef's own declaration — NOVA code for `type_a_nova`, the
 * cooperative for `type_b_cooperative`. The client-level totals here are a dashboard
 * summary: no single document can cover amounts from several independent providers,
 * which is why every response carries a `providers` breakdown.
 *
 * Only `succeeded` payments count, so a refunded payment drops out on its own.
 *
 * JSON only — the rendered PDF is a separate deliverable, still waiting on the legal
 * template. Nothing is persisted (no `FiscalAttestationDocument` table) until then.
 */
@Injectable()
export class FiscalAttestationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  async summarizeForClerkUser(
    clerkUserId: string,
    year: number,
  ): Promise<FiscalAttestationDto> {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    return this.summarize(user.id, year);
  }

  async summarizeForClientId(
    clientId: string,
    year: number,
  ): Promise<FiscalAttestationDto> {
    const client = await this.prisma.user.findUnique({
      where: { id: clientId },
      select: { id: true, fullName: true, email: true },
    });
    if (!client) {
      throw new NotFoundException(`Client ${clientId} not found.`);
    }
    return this.summarize(clientId, year, client);
  }

  /** One entry per client who paid at least once during `year`, biggest total first. */
  async summarizeAllClients(year: number): Promise<FiscalAttestationDto[]> {
    const payments = await this.loadPayments(year);

    const byClient = new Map<string, AttestationPayment[]>();
    for (const payment of payments) {
      const clientId = payment.booking.client.id;
      const bucket = byClient.get(clientId);
      if (bucket) {
        bucket.push(payment);
      } else {
        byClient.set(clientId, [payment]);
      }
    }

    return [...byClient.values()]
      .map((rows) => this.buildAttestation(rows[0].booking.client, year, rows))
      .sort((a, b) => b.eligibleAmountCents - a.eligibleAmountCents);
  }

  private async summarize(
    clientId: string,
    year: number,
    known?: { id: string; fullName: string | null; email: string },
  ): Promise<FiscalAttestationDto> {
    const payments = await this.loadPayments(year, clientId);
    const client =
      known ??
      payments[0]?.booking.client ??
      (await this.prisma.user.findUnique({
        where: { id: clientId },
        select: { id: true, fullName: true, email: true },
      }));

    return this.buildAttestation(
      client ?? { id: clientId, fullName: null, email: '' },
      year,
      payments,
    );
  }

  /** Groups a client's payments by issuing chef and totals each side. */
  private buildAttestation(
    client: { id: string; fullName: string | null; email: string },
    year: number,
    payments: AttestationPayment[],
  ): FiscalAttestationDto {
    const byProvider = new Map<string, FiscalAttestationProviderDto>();

    for (const payment of payments) {
      const chef = payment.booking.chefProfile;
      const eligible = payment.taxCreditEligibleAmount ?? payment.amountTtc;

      const existing = byProvider.get(chef.id);
      if (existing) {
        existing.eligibleAmountCents += eligible;
        existing.paymentsCount += 1;
        continue;
      }

      byProvider.set(chef.id, {
        chefProfileId: chef.id,
        chefDisplayName: chef.displayName,
        sapDeclared: chef.sapProfile !== null,
        declarationType: chef.sapProfile?.declarationType ?? null,
        novaCode: chef.sapProfile?.novaCode ?? null,
        cooperativeName: chef.sapProfile?.cooperativeName ?? null,
        eligibleAmountCents: eligible,
        paymentsCount: 1,
        currency: payment.currency,
      });
    }

    const providers = [...byProvider.values()].sort(
      (a, b) => b.eligibleAmountCents - a.eligibleAmountCents,
    );

    return {
      clientId: client.id,
      clientName: client.fullName,
      clientEmail: client.email,
      year,
      eligibleAmountCents: providers.reduce(
        (total, provider) => total + provider.eligibleAmountCents,
        0,
      ),
      paymentsCount: providers.reduce(
        (total, provider) => total + provider.paymentsCount,
        0,
      ),
      currency: providers[0]?.currency ?? 'EUR',
      providers,
    };
  }

  private loadPayments(year: number, clientId?: string): Promise<AttestationPayment[]> {
    return this.prisma.payment.findMany({
      where: {
        status: 'succeeded',
        // `paidAt`, not `createdAt`: an intent created on 31 December and settled on
        // 1 January belongs to the later tax year.
        paidAt: {
          gte: new Date(Date.UTC(year, 0, 1)),
          lt: new Date(Date.UTC(year + 1, 0, 1)),
        },
        ...(clientId ? { booking: { clientId } } : {}),
      },
      select: {
        amountTtc: true,
        currency: true,
        taxCreditEligibleAmount: true,
        booking: {
          select: {
            client: { select: { id: true, fullName: true, email: true } },
            chefProfile: {
              select: {
                id: true,
                displayName: true,
                sapProfile: {
                  select: {
                    declarationType: true,
                    novaCode: true,
                    cooperativeName: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  }
}
