import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { AuditService } from '../../../common/audit/audit.service';
import type { ChefTier, PaymentMethod, Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { chefTierLabels } from '../../platform-settings/chef-tiers';
import {
  cesuFeeBpsFor,
  cesuFeeRulesInForce,
  type CesuFeeRules,
} from '../../platform-settings/cesu-fee';
import { UsersService } from '../../users/users.service';
import { bankFeedConfig } from '../cesu-reconciliation/bank-feed';
import { isLate, netPrice, SERVICE_VAT_RATE_BPS, type NetPrice } from './net-price';

/** Money the SAS collects itself and pays out at the net price. */
const BANK_METHODS: PaymentMethod[] = ['cesu', 'avance_immediate'];

export const BANK_RECONCILIATION_KEY = 'bank_reconciliation';

export type PayoutView = 'payable' | 'awaiting' | 'paid';

export interface PayoutLine extends NetPrice {
  /** The payout id; null for a payment still awaited (no payout exists yet). */
  id: string | null;
  paymentId: string;
  method: PaymentMethod;
  bookingReference: string | null;
  receivedAt: string | null;
  paidAt: string | null;
  paidReference: string | null;
  late: boolean;
}

export interface PayoutsSummary {
  payableCents: number;
  payableChefs: number;
  vatCents: number;
  marginCents: number;
  awaitingCents: number;
  lateChefs: number;
  lateCents: number;
  lastReconciliation: { at: string; received: number; matched: number } | null;
  bankFeedConfigured: boolean;
}

export interface PayoutChefHit {
  chefProfileId: string;
  displayName: string;
  city: string | null;
  tierLabel: string;
  payableCents: number;
  awaitingCents: number;
}

export interface PayoutPeriod {
  from?: Date;
  to?: Date;
}

/** Only commissions withheld at payout: older CESU rows went to the chef directly. */
const WITHHELD = { collectionMethod: 'payout_withholding' } as const;

const AWAITED_SELECT = {
  id: true,
  method: true,
  amountTtc: true,
  createdAt: true,
  booking: { select: { reference: true, chefProfile: { select: { tier: true } } } },
  commission: { select: { rateBps: true } },
} satisfies Prisma.PaymentSelect;

/**
 * « Prix nets à verser » (MajorD, 25/11/2026): what Labs Food Batchcooking SAS owes each
 * batch cooker for the CESU and immediate-advance money it received, the admin's
 * payout list, and the marking of a transfer as made.
 */
@Injectable()
export class ChefPayoutsService {
  private readonly logger = new Logger(ChefPayoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Creates the payout of every received payment that has none yet, with the rates in
   * force now frozen on it. Idempotent: the payment id is unique on `chef_payouts`.
   */
  async sync(): Promise<number> {
    const received = await this.prisma.payment.findMany({
      where: {
        purpose: 'service',
        status: 'succeeded',
        method: { in: BANK_METHODS },
        chefPayout: null,
        commission: WITHHELD,
      },
      select: {
        id: true,
        method: true,
        amountTtc: true,
        paidAt: true,
        updatedAt: true,
        booking: {
          select: { chefProfileId: true, chefProfile: { select: { tier: true } } },
        },
        commission: { select: { rateBps: true } },
      },
      take: 500,
    });
    if (received.length === 0) return 0;

    const feeRules = await cesuFeeRulesInForce(this.prisma);
    const created = await this.prisma.chefPayout.createMany({
      data: received.map((p) => {
        const price = this.priceOf(
          p.method,
          p.amountTtc,
          p.commission?.rateBps ?? 0,
          p.booking.chefProfile.tier,
          feeRules,
        );
        return {
          paymentId: p.id,
          chefProfileId: p.booking.chefProfileId,
          method: p.method,
          ...price,
          receivedAt: p.paidAt ?? p.updatedAt,
        };
      }),
      skipDuplicates: true,
    });
    this.logger.log({ event: 'payouts.synced', created: created.count });
    return created.count;
  }

  async summary(now = new Date()): Promise<PayoutsSummary> {
    await this.sync();
    const [payable, awaiting, last] = await Promise.all([
      this.prisma.chefPayout.findMany({
        where: { status: 'payable' },
        select: {
          chefProfileId: true,
          netCents: true,
          amountVatCents: true,
          commissionCents: true,
          cesuFeeCents: true,
          receivedAt: true,
        },
      }),
      this.prisma.payment.aggregate({
        where: this.awaitedWhere(),
        _sum: { amountTtc: true },
      }),
      this.prisma.platformSetting.findUnique({ where: { key: BANK_RECONCILIATION_KEY } }),
    ]);

    const chefs = new Set<string>();
    const lateChefs = new Set<string>();
    let lateCents = 0;
    for (const p of payable) {
      chefs.add(p.chefProfileId);
      if (isLate(p.receivedAt, now)) {
        lateChefs.add(p.chefProfileId);
        lateCents += p.netCents;
      }
    }
    const sum = (pick: (p: (typeof payable)[number]) => number) =>
      payable.reduce((total, p) => total + pick(p), 0);

    return {
      payableCents: sum((p) => p.netCents),
      payableChefs: chefs.size,
      vatCents: sum((p) => p.amountVatCents),
      marginCents: sum((p) => p.commissionCents + p.cesuFeeCents),
      awaitingCents: awaiting._sum.amountTtc ?? 0,
      lateChefs: lateChefs.size,
      lateCents,
      lastReconciliation: readLastReconciliation(last?.value),
      bankFeedConfigured: bankFeedConfig() !== null,
    };
  }

  /**
   * Batch cookers for the search bar: by name, city, e-mail or booking reference, the
   * most to pay first. Without a query, only those with something payable or awaited.
   */
  async searchChefs(query: string | undefined, limit = 20): Promise<PayoutChefHit[]> {
    await this.sync();
    const q = query?.trim();
    const where: Prisma.ChefProfileWhereInput = q
      ? {
          OR: [
            { displayName: { contains: q, mode: 'insensitive' } },
            { city: { contains: q, mode: 'insensitive' } },
            { user: { email: { contains: q, mode: 'insensitive' } } },
            { user: { fullName: { contains: q, mode: 'insensitive' } } },
            { bookings: { some: { reference: { contains: q, mode: 'insensitive' } } } },
          ],
        }
      : {
          OR: [
            { chefPayouts: { some: { status: 'payable' } } },
            { bookings: { some: { payments: { some: this.awaitedWhere() } } } },
          ],
        };

    const [chefs, labels] = await Promise.all([
      this.prisma.chefProfile.findMany({
        where,
        select: { id: true, displayName: true, city: true, tier: true },
        take: 100,
      }),
      chefTierLabels(this.prisma),
    ]);
    if (chefs.length === 0) return [];
    const ids = chefs.map((c) => c.id);

    const [payable, awaited] = await Promise.all([
      this.prisma.chefPayout.groupBy({
        by: ['chefProfileId'],
        where: { status: 'payable', chefProfileId: { in: ids } },
        _sum: { netCents: true },
      }),
      this.prisma.payment.findMany({
        where: { ...this.awaitedWhere(), booking: { chefProfileId: { in: ids } } },
        select: { amountTtc: true, booking: { select: { chefProfileId: true } } },
      }),
    ]);
    const payableBy = new Map(
      payable.map((p) => [p.chefProfileId, p._sum.netCents ?? 0]),
    );
    const awaitedBy = new Map<string, number>();
    for (const p of awaited) {
      const id = p.booking.chefProfileId;
      awaitedBy.set(id, (awaitedBy.get(id) ?? 0) + p.amountTtc);
    }

    return chefs
      .map((c) => ({
        chefProfileId: c.id,
        displayName: c.displayName,
        city: c.city,
        tierLabel: labels[c.tier],
        payableCents: payableBy.get(c.id) ?? 0,
        awaitingCents: awaitedBy.get(c.id) ?? 0,
      }))
      .sort(
        (a, b) =>
          b.payableCents - a.payableCents ||
          b.awaitingCents - a.awaitingCents ||
          a.displayName.localeCompare(b.displayName, 'fr'),
      )
      .slice(0, limit);
  }

  /** One batch cooker's card: identity, counts per view, and the lines of `view`. */
  async chefPayouts(
    chefProfileId: string,
    view: PayoutView,
    period: PayoutPeriod,
    now = new Date(),
  ) {
    await this.sync();
    const chef = await this.prisma.chefProfile.findUnique({
      where: { id: chefProfileId },
      select: {
        id: true,
        displayName: true,
        city: true,
        tier: true,
        sepaMandate: { select: { ibanLast4: true } },
      },
    });
    if (!chef) throw new NotFoundException('No batch cooker with this id.');
    const labels = await chefTierLabels(this.prisma);

    const received = rangeOn('receivedAt', period);
    const paidRange = rangeOn('paidAt', period);
    const created = rangeOn('createdAt', period);
    const awaitedWhere = {
      ...this.awaitedWhere(),
      ...created,
      booking: { chefProfileId },
    };

    const [payableCount, awaitingCount, paidCount] = await Promise.all([
      this.prisma.chefPayout.count({
        where: { chefProfileId, status: 'payable', ...received },
      }),
      this.prisma.payment.count({ where: awaitedWhere }),
      this.prisma.chefPayout.count({
        where: { chefProfileId, status: 'paid', ...paidRange },
      }),
    ]);

    const lines =
      view === 'awaiting'
        ? await this.awaitedLines(awaitedWhere, chef.tier)
        : await this.payoutLines(
            { chefProfileId, status: view, ...(view === 'paid' ? paidRange : received) },
            now,
          );

    return {
      chef: {
        chefProfileId: chef.id,
        displayName: chef.displayName,
        city: chef.city,
        tierLabel: labels[chef.tier],
        ibanLast4: chef.sepaMandate?.ibanLast4 ?? null,
      },
      counts: { payable: payableCount, awaiting: awaitingCount, paid: paidCount },
      totalNetCents: lines.reduce((total, l) => total + l.netCents, 0),
      lines,
    };
  }

  /**
   * The admin made the transfer: these payouts are paid, and the Labs Food part kept
   * back on them is collected. Only payable payouts of this batch cooker move.
   */
  async markPaid(
    adminClerkUserId: string,
    chefProfileId: string,
    payoutIds: string[],
    reference?: string,
  ) {
    const admin = await this.users.ensurePersistedFromClerk(adminClerkUserId);
    const paidAt = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const payouts = await tx.chefPayout.findMany({
        where: { id: { in: payoutIds }, chefProfileId, status: 'payable' },
        select: { id: true, paymentId: true, netCents: true },
      });
      if (payouts.length === 0) {
        throw new NotFoundException('Nothing left to pay among these lines.');
      }
      const ids = payouts.map((p) => p.id);
      await tx.chefPayout.updateMany({
        where: { id: { in: ids }, status: 'payable' },
        data: {
          status: 'paid',
          paidAt,
          paidByUserId: admin.id,
          paidReference: reference?.trim().slice(0, 140) || null,
        },
      });
      await tx.commission.updateMany({
        where: { paymentId: { in: payouts.map((p) => p.paymentId) }, ...WITHHELD },
        data: { status: 'collected', collectedAt: paidAt },
      });
      return {
        paid: payouts.length,
        netCents: payouts.reduce((total, p) => total + p.netCents, 0),
        payoutIds: ids,
      };
    });

    await this.audit.record({
      actorType: 'admin',
      actorUserId: admin.id,
      action: 'payout.marked_paid',
      subjectType: 'chef_profile',
      subjectId: chefProfileId,
      metadata: { payoutIds: result.payoutIds, netCents: result.netCents },
    });
    return { paid: result.paid, netCents: result.netCents, paidAt: paidAt.toISOString() };
  }

  /** CESU declared but not received yet, and immediate advances URSSAF has not paid. */
  private awaitedWhere(): Prisma.PaymentWhereInput {
    return {
      purpose: 'service',
      status: 'pending',
      method: { in: BANK_METHODS },
      commission: WITHHELD,
    };
  }

  private async payoutLines(
    where: Prisma.ChefPayoutWhereInput,
    now: Date,
  ): Promise<PayoutLine[]> {
    const rows = await this.prisma.chefPayout.findMany({
      where,
      orderBy: { receivedAt: 'asc' },
      take: 200,
      include: { payment: { select: { booking: { select: { reference: true } } } } },
    });
    return rows.map((r) => ({
      id: r.id,
      paymentId: r.paymentId,
      method: r.method,
      bookingReference: r.payment.booking.reference,
      amountTtcCents: r.amountTtcCents,
      vatRateBps: r.vatRateBps,
      amountHtCents: r.amountHtCents,
      amountVatCents: r.amountVatCents,
      commissionRateBps: r.commissionRateBps,
      commissionCents: r.commissionCents,
      cesuFeeBps: r.cesuFeeBps,
      cesuFeeCents: r.cesuFeeCents,
      netCents: r.netCents,
      receivedAt: r.receivedAt.toISOString(),
      paidAt: r.paidAt?.toISOString() ?? null,
      paidReference: r.paidReference,
      late: r.status === 'payable' && isLate(r.receivedAt, now),
    }));
  }

  /** Not frozen yet: priced with the rates in force, as an estimate. */
  private async awaitedLines(
    where: Prisma.PaymentWhereInput,
    tier: ChefTier,
  ): Promise<PayoutLine[]> {
    const [rows, feeRules] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        select: AWAITED_SELECT,
        orderBy: { createdAt: 'asc' },
        take: 200,
      }),
      cesuFeeRulesInForce(this.prisma),
    ]);
    return rows.map((p) => ({
      id: null,
      paymentId: p.id,
      method: p.method,
      bookingReference: p.booking.reference,
      ...this.priceOf(p.method, p.amountTtc, p.commission?.rateBps ?? 0, tier, feeRules),
      receivedAt: null,
      paidAt: null,
      paidReference: null,
      late: false,
    }));
  }

  private priceOf(
    method: PaymentMethod,
    amountTtcCents: number,
    commissionRateBps: number,
    tier: ChefTier,
    feeRules: CesuFeeRules,
  ): NetPrice {
    return netPrice({
      amountTtcCents,
      vatRateBps: SERVICE_VAT_RATE_BPS,
      commissionRateBps,
      cesuFeeBps: method === 'cesu' ? cesuFeeBpsFor(feeRules, tier) : 0,
    });
  }
}

function rangeOn<K extends string>(field: K, period: PayoutPeriod) {
  if (!period.from && !period.to) return {};
  return {
    [field]: {
      ...(period.from ? { gte: period.from } : {}),
      ...(period.to ? { lt: period.to } : {}),
    },
  } as Record<K, { gte?: Date; lt?: Date }>;
}

export function readLastReconciliation(
  value: unknown,
): PayoutsSummary['lastReconciliation'] {
  const v = (value ?? null) as {
    at?: unknown;
    received?: unknown;
    matched?: unknown;
  } | null;
  if (!v || typeof v.at !== 'string') return null;
  return {
    at: v.at,
    received: typeof v.received === 'number' ? v.received : 0,
    matched: typeof v.matched === 'number' ? v.matched : 0,
  };
}
