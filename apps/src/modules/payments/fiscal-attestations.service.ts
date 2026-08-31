import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { FiscalAttestationDto } from './dto/payment.dto';

/**
 * Yearly totals backing the "attestation fiscale" a client attaches to their tax
 * return for the 50 % "service à la personne" credit.
 *
 * JSON aggregation only — no PDF is rendered yet. That is a deliberate fast-follow:
 * the legal template has to be validated first, and there is nothing worth persisting
 * (no `FiscalAttestationDocument` table) until a rendering exists.
 *
 * Only `succeeded` payments count, so a refunded payment drops out of the total on
 * its own.
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
    const client = await this.prisma.user.findUnique({ where: { id: clientId } });
    if (!client) {
      throw new NotFoundException(`Client ${clientId} not found.`);
    }
    return this.summarize(clientId, year);
  }

  /** One row per client who paid at least once during `year`, biggest total first. */
  async summarizeAllClients(year: number): Promise<FiscalAttestationDto[]> {
    const payments = await this.prisma.payment.findMany({
      where: this.yearFilter(year),
      select: {
        amountTtc: true,
        currency: true,
        taxCreditEligibleAmount: true,
        booking: {
          select: { client: { select: { id: true, fullName: true, email: true } } },
        },
      },
    });

    const byClient = new Map<string, FiscalAttestationDto>();
    for (const payment of payments) {
      const client = payment.booking.client;
      const row = byClient.get(client.id) ?? {
        clientId: client.id,
        clientName: client.fullName,
        clientEmail: client.email,
        year,
        eligibleAmountCents: 0,
        paymentsCount: 0,
        currency: payment.currency,
      };
      row.eligibleAmountCents += payment.taxCreditEligibleAmount ?? payment.amountTtc;
      row.paymentsCount += 1;
      byClient.set(client.id, row);
    }

    return [...byClient.values()].sort(
      (a, b) => b.eligibleAmountCents - a.eligibleAmountCents,
    );
  }

  private async summarize(clientId: string, year: number): Promise<FiscalAttestationDto> {
    const [client, payments] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: clientId },
        select: { id: true, fullName: true, email: true },
      }),
      this.prisma.payment.findMany({
        where: { ...this.yearFilter(year), booking: { clientId } },
        select: { amountTtc: true, currency: true, taxCreditEligibleAmount: true },
      }),
    ]);

    const eligibleAmountCents = payments.reduce(
      (total, payment) => total + (payment.taxCreditEligibleAmount ?? payment.amountTtc),
      0,
    );

    return {
      clientId,
      clientName: client?.fullName ?? null,
      clientEmail: client?.email ?? '',
      year,
      eligibleAmountCents,
      paymentsCount: payments.length,
      currency: payments[0]?.currency ?? 'EUR',
    };
  }

  /**
   * `paidAt` (not `createdAt`) decides the tax year: a payment intent created on
   * 31 December and settled on 1 January belongs to the later year.
   */
  private yearFilter(year: number) {
    return {
      status: 'succeeded' as const,
      paidAt: {
        gte: new Date(Date.UTC(year, 0, 1)),
        lt: new Date(Date.UTC(year + 1, 0, 1)),
      },
    };
  }
}
