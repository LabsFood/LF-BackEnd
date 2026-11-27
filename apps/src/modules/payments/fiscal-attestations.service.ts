import { Injectable, NotFoundException } from '@nestjs/common';

import type { PaymentMethod } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { FiscalAttestationDto, FiscalAttestationProviderDto } from './dto/payment.dto';
import { sasIdentity } from './sas-identity';

/** Wording carried back to the client for the part their issuer attests, not the platform. */
export const ECESU_ATTESTATION_NOTE =
  'Part réglée en e-CESU — attestation délivrée par votre émetteur.';

/** Payment row shape the aggregation needs: amounts plus who was paid, by whom. */
type AttestationPayment = {
  amountTtc: number;
  currency: string;
  taxCreditEligibleAmount: number | null;
  method: PaymentMethod;
  cesuSettlement: { medium: 'ecesu' | 'cesu_paper' } | null;
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
 * **Lab's Food is the provider (prestataire)**: the SAS collects every payment and
 * invoices the household in its own name (prix net flow), so it issues one attestation
 * per client and year under its own SAP declaration (`sasIdentity()`, MajorD
 * 26/11/2026). `providers` is a per-batch-cooker breakdown; the chef's own SAP/NOVA
 * stays on it for the admin's dossier check only.
 *
 * Only `succeeded` payments count, so a refunded payment drops out on its own.
 *
 * JSON only — the rendered PDF is a separate deliverable, still waiting on the legal
 * template. Nothing is persisted (no `FiscalAttestationDocument` table) until then.
 *
 * ponytail: no PDF rendering — legal template blocks it. Same deferral as facture B
 * (commission-invoice.dto.ts, schema.prisma `pdfObjectKey`/`s3ArchivedAt`). Build when
 * the template is validated.
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
      const exclusion = attestationExclusion(payment);
      const attested = exclusion === null ? eligible : 0;
      const method = payment.method;

      const existing = byProvider.get(chef.id);
      if (existing) {
        existing.eligibleAmountCents += eligible;
        existing.platformAttestedAmountCents += attested;
        existing.paymentsCount += 1;
        if (!existing.paymentMethods.includes(method)) {
          existing.paymentMethods.push(method);
        }
        if (exclusion && !existing.notes.includes(exclusion)) {
          existing.notes.push(exclusion);
        }
        continue;
      }

      const provider: FiscalAttestationProviderDto = {
        chefProfileId: chef.id,
        chefDisplayName: chef.displayName,
        sapDeclared: chef.sapProfile !== null,
        declarationType: chef.sapProfile?.declarationType ?? null,
        novaCode: chef.sapProfile?.novaCode ?? null,
        cooperativeName: chef.sapProfile?.cooperativeName ?? null,
        eligibleAmountCents: eligible,
        platformAttestedAmountCents: attested,
        paymentMethods: [method],
        notes: exclusion ? [exclusion] : [],
        paymentsCount: 1,
        currency: payment.currency,
      };
      byProvider.set(chef.id, provider);
    }

    const providers = [...byProvider.values()].sort(
      (a, b) => b.eligibleAmountCents - a.eligibleAmountCents,
    );

    return {
      issuer: attestationIssuer(),
      clientId: client.id,
      clientName: client.fullName,
      clientEmail: client.email,
      year,
      eligibleAmountCents: providers.reduce(
        (total, provider) => total + provider.eligibleAmountCents,
        0,
      ),
      platformAttestedAmountCents: providers.reduce(
        (total, provider) => total + provider.platformAttestedAmountCents,
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
        // Recettes lot 6: the tax credit is on the service, never on the groceries.
        purpose: 'service',
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
        // Added for `isPlatformAttestable`: the medium is only reachable through the
        // settlement, and the method is what says whether to look for one.
        method: true,
        cesuSettlement: { select: { medium: true } },
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

/** The SAS, under its own SAP declaration: the issuer of every attestation. */
export function attestationIssuer(): FiscalAttestationDto['issuer'] {
  const { name, legalName, siren, address, sapDeclarationNumber } = sasIdentity();
  return { name, legalName, siren, address, sapDeclarationNumber };
}

/**
 * Whether Lab's Food may attest this payment: the single predicate behind
 * `platformAttestedAmountCents`.
 *
 * The client's own eligible total stays complete either way; what narrows is the part
 * the SAS puts its name to. One exclusion, kept in one place so a later accounting
 * ruling is one edit and one test rather than a hunt:
 *
 * - **e-CESU**: the issuer already attests the share it financed. Paper CESU stays
 *   attested by the SAS.
 *
 * The chef's declaration route (NOVA or cooperative) no longer matters: the SAS
 * invoices the household for every booking, so it attests every booking.
 *
 * ⚠️ Open question flagged for the accountant: paper and electronic CESU are both
 * *prefinanced*, from the same issuers, and the issuer's attestation covers both, so
 * attesting paper may carry the same over-declaration exposure under art. 199 sexdecies
 * CGI, and it is the SAS that signs. If that is confirmed, the fix is one line here.
 *
 * ponytail: pending accountant sign-off on paper CESU. Upgrade: fold paper into the
 * e-CESU check below once confirmed — one line, no migration.
 */
export function attestationExclusion(
  payment: AttestationPayment,
): typeof ECESU_ATTESTATION_NOTE | null {
  if (payment.method === 'cesu' && payment.cesuSettlement?.medium === 'ecesu') {
    return ECESU_ATTESTATION_NOTE;
  }
  return null;
}

export function isPlatformAttestable(payment: AttestationPayment): boolean {
  return attestationExclusion(payment) === null;
}
