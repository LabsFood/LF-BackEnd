import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { AuditService } from '../../../common/audit/audit.service';
import type { ChefTier, PaymentMethod, Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { chefTierLabels } from '../../platform-settings/chef-tiers';
import {
  cesuFeeBpsFor,
  cesuFeeRulesInForce,
  type CesuFeeRules,
} from '../../platform-settings/cesu-fee';
import { StripeService } from '../../../integrations/stripe.service';
import { UsersService } from '../../users/users.service';
import { bankFeedConfig } from '../cesu-reconciliation/bank-feed';
import { PaymentInvoicesService } from '../payment-invoices.service';
import { PayoutStatementsService } from './payout-statements.service';
import { isLate, netPrice, SERVICE_VAT_RATE_BPS, type NetPrice } from './net-price';

/** Money the SAS collects itself and pays out at the net price. */
/** Paid into the SAS's bank account: awaited until the bank shows the credit. */
const BANK_METHODS: PaymentMethod[] = ['cesu', 'avance_immediate'];
/**
 * Everything the SAS buys from the batch cooker at the net price. The card joins on
 * 26/11/2026 (« carte au prix net »): charged on the SAS's own Stripe account, its net
 * is transferred to the batch cooker's connected account.
 */
const PAYOUT_METHODS: PaymentMethod[] = [...BANK_METHODS, 'cb'];

type PayoutActor = { type: 'admin'; userId: string } | { type: 'system' };

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
  /** The autofacture this line was paid under. */
  statementId: string | null;
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
  /** The batch cooker to pay first (the longest waiting), so the bell opens their card. */
  nextChefProfileId: string | null;
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
 * « Prix nets à verser » (MajorD, 25/11/2026): what Lab’s Food owes each
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
    private readonly statements: PayoutStatementsService,
    private readonly stripe: StripeService,
    private readonly invoices: PaymentInvoicesService,
  ) {}

  /**
   * The SAS's invoice to the household for the money it has received by bank (CESU,
   * avance immédiate; the card's is issued by its webhook). Picks up every received
   * payment still without one, so a failure is retried at the next sync.
   */
  private async invoiceReceived(): Promise<void> {
    const missing = await this.prisma.payment.findMany({
      where: {
        purpose: 'service',
        status: 'succeeded',
        method: { in: BANK_METHODS },
        commission: WITHHELD,
        invoice: null,
      },
      select: { id: true, paidAt: true, updatedAt: true },
      orderBy: { paidAt: 'asc' },
      take: 100,
    });
    for (const p of missing) {
      try {
        await this.invoices.issueNow(p.id, p.paidAt ?? p.updatedAt);
      } catch (error) {
        this.logger.error({
          event: 'payouts.client_invoice_failed',
          paymentId: p.id,
          reason: error instanceof Error ? error.message : 'unknown error',
        });
      }
    }
  }

  /**
   * Creates the payout of every received payment that has none yet, with the rates in
   * force now frozen on it. Idempotent: the payment id is unique on `chef_payouts`.
   */
  async sync(): Promise<number> {
    const received = await this.prisma.payment.findMany({
      where: {
        purpose: 'service',
        status: 'succeeded',
        method: { in: PAYOUT_METHODS },
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
    if (received.length === 0) {
      await this.invoiceReceived();
      return 0;
    }

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
    await this.invoiceReceived();
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

    const oldest = [...payable].sort(
      (a, b) => a.receivedAt.getTime() - b.receivedAt.getTime(),
    )[0];
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
      nextChefProfileId: oldest?.chefProfileId ?? null,
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
    const [labels, statementBlockers] = await Promise.all([
      chefTierLabels(this.prisma),
      this.statements.blockers(chefProfileId),
    ]);

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
        /** Empty when an autofacture can be issued, so « Marquer versé » can go. */
        statementBlockers,
      },
      counts: { payable: payableCount, awaiting: awaitingCount, paid: paidCount },
      totalNetCents: lines.reduce((total, l) => total + l.netCents, 0),
      lines,
    };
  }

  /** The batch cooker's own payouts: same lines as the admin card, own profile only. */
  async myPayouts(clerkUserId: string, view: PayoutView, period: PayoutPeriod) {
    const { id } = await this.users.requireOwnChefProfile(clerkUserId);
    return this.chefPayouts(id, view, period);
  }

  /**
   * The admin made the transfer: these payouts are paid, and the Lab’s Food part kept
   * back on them is collected. Only payable payouts of this batch cooker move.
   */
  async markPaid(
    adminClerkUserId: string,
    chefProfileId: string,
    payoutIds: string[],
    reference?: string,
  ) {
    const admin = await this.users.ensurePersistedFromClerk(adminClerkUserId);
    return this.settle(
      { type: 'admin', userId: admin.id },
      chefProfileId,
      payoutIds,
      reference,
    );
  }

  /**
   * A card payment just succeeded: its net goes to the batch cooker's Stripe account
   * at once, with its autofacture. Best-effort: when the autofacture cannot be issued
   * yet (legal identity missing) or the transfer fails, the line stays « à verser »
   * in the console, and « Marquer versé » makes the same transfer later.
   */
  async payCardNow(paymentId: string): Promise<void> {
    await this.sync();
    const payout = await this.prisma.chefPayout.findFirst({
      where: { paymentId, method: 'cb', status: 'payable' },
      select: { id: true, chefProfileId: true },
    });
    if (!payout) return;
    const blockers = await this.statements.blockers(payout.chefProfileId);
    if (blockers.length > 0) {
      this.logger.warn({
        event: 'payout.card_waiting_identity',
        paymentId,
        missing: blockers,
      });
      return;
    }
    try {
      await this.settle({ type: 'system' }, payout.chefProfileId, [payout.id]);
    } catch (error) {
      this.logger.error({
        event: 'payout.card_transfer_failed',
        paymentId,
        reason: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }

  /**
   * Pays these payable lines: card lines by Stripe transfer to the connected account
   * (idempotent per line), the others by the bank transfer the admin already made.
   * Then one autofacture for the lot.
   */
  private async settle(
    actor: PayoutActor,
    chefProfileId: string,
    payoutIds: string[],
    reference?: string,
  ) {
    const blockers = await this.statements.blockers(chefProfileId);
    if (blockers.length > 0) {
      throw new ConflictException({
        code: 'PAYOUT_STATEMENT_INCOMPLETE',
        message:
          'The autofacture cannot be issued: complete the batch cooker’s legal identity first.',
        missing: blockers,
      });
    }
    const paidAt = new Date();
    const paidReference = reference?.trim().slice(0, 140) || null;
    const transfers = await this.transferCardLines(chefProfileId, payoutIds);
    const paidByUserId = actor.type === 'admin' ? actor.userId : null;
    const result = await this.withNumberRetry(() =>
      this.prisma.$transaction(async (tx) => {
        const payouts = await tx.chefPayout.findMany({
          where: { id: { in: payoutIds }, chefProfileId, status: 'payable' },
          include: { payment: { select: { booking: { select: { reference: true } } } } },
          orderBy: { receivedAt: 'asc' },
        });
        if (payouts.length === 0) {
          throw new NotFoundException('Nothing left to pay among these lines.');
        }
        const ids = payouts.map((p) => p.id);
        const paid = { status: 'paid' as const, paidAt, paidByUserId };
        // Bank lines share the admin's transfer reference; each card line keeps its own
        // Stripe transfer id.
        const bankIds = ids.filter((id) => !transfers.has(id));
        let claimed =
          bankIds.length > 0
            ? (
                await tx.chefPayout.updateMany({
                  where: { id: { in: bankIds }, status: 'payable' },
                  data: { ...paid, paidReference },
                })
              ).count
            : 0;
        for (const [id, transferId] of transfers) {
          const done = await tx.chefPayout.updateMany({
            where: { id, status: 'payable' },
            data: { ...paid, paidReference: transferId },
          });
          claimed += done.count;
        }
        if (claimed !== ids.length) {
          throw new ConflictException('These lines were marked paid a moment ago.');
        }
        await tx.commission.updateMany({
          where: { paymentId: { in: payouts.map((p) => p.paymentId) }, ...WITHHELD },
          data: { status: 'collected', collectedAt: paidAt },
        });
        const statement = await this.statements.issue(tx, {
          chefProfileId,
          payouts,
          paidAt,
          transferReference:
            paidReference ?? ([...transfers.values()].join(', ') || null),
        });
        return {
          paid: payouts.length,
          netCents: payouts.reduce((total, p) => total + p.netCents, 0),
          payoutIds: ids,
          statement,
        };
      }),
    );

    await this.statements.archive(result.statement.id);
    await this.statements.transmit(result.statement.id);
    await this.audit.record({
      actorType: actor.type,
      actorUserId: paidByUserId,
      action: 'payout.marked_paid',
      subjectType: 'chef_profile',
      subjectId: chefProfileId,
      metadata: {
        payoutIds: result.payoutIds,
        netCents: result.netCents,
        statementNumber: result.statement.number,
        stripeTransfers: [...transfers.values()],
      },
    });
    return {
      paid: result.paid,
      netCents: result.netCents,
      paidAt: paidAt.toISOString(),
      statementId: result.statement.id,
      statementNumber: result.statement.number,
    };
  }

  /**
   * Stripe transfer of the net of each payable card line to the batch cooker's
   * connected account, tied to its charge (`source_transaction`: usable before the
   * charge's funds are available). The idempotency key is the line, so a retry after
   * a failure further down never transfers twice.
   */
  private async transferCardLines(
    chefProfileId: string,
    payoutIds: string[],
  ): Promise<Map<string, string>> {
    const cards = await this.prisma.chefPayout.findMany({
      where: { id: { in: payoutIds }, chefProfileId, status: 'payable', method: 'cb' },
      select: {
        id: true,
        method: true,
        netCents: true,
        payment: { select: { stripeChargeId: true, currency: true, bookingId: true } },
        chefProfile: { select: { stripeAccountId: true } },
      },
    });
    const transfers = new Map<string, string>();
    const cardLines = cards.filter((c) => c.method === 'cb');
    if (cardLines.length === 0) return transfers;
    const destination = cardLines[0].chefProfile.stripeAccountId;
    if (!destination || !this.stripe.configured) {
      throw new ConflictException({
        code: 'PAYOUT_STRIPE_ACCOUNT_MISSING',
        message:
          'Card lines are paid by Stripe transfer: the batch cooker has no Stripe account.',
      });
    }
    for (const card of cardLines) {
      if (card.netCents <= 0) continue;
      const transfer = await this.stripe.getClient().transfers.create(
        {
          amount: card.netCents,
          currency: card.payment.currency.toLowerCase(),
          destination,
          transfer_group: card.payment.bookingId,
          ...(card.payment.stripeChargeId
            ? { source_transaction: card.payment.stripeChargeId }
            : {}),
          metadata: { chefPayoutId: card.id },
        },
        { idempotencyKey: `chef-payout-${card.id}` },
      );
      transfers.set(card.id, transfer.id);
    }
    return transfers;
  }

  /** Every line still to pay, all batch cookers, for the day's export. */
  async payableLines(now = new Date()) {
    await this.sync();
    const rows = await this.prisma.chefPayout.findMany({
      where: { status: 'payable' },
      orderBy: [{ chefProfileId: 'asc' }, { receivedAt: 'asc' }],
      take: 2000,
      include: {
        chefProfile: { select: { displayName: true } },
        payment: { select: { booking: { select: { reference: true } } } },
      },
    });
    return rows.map((r) => ({
      chefProfileId: r.chefProfileId,
      chefName: r.chefProfile.displayName,
      bookingReference: r.payment.booking.reference,
      method: r.method,
      amountTtcCents: r.amountTtcCents,
      vatRateBps: r.vatRateBps,
      amountVatCents: r.amountVatCents,
      amountHtCents: r.amountHtCents,
      commissionRateBps: r.commissionRateBps,
      commissionCents: r.commissionCents,
      cesuFeeBps: r.cesuFeeBps,
      cesuFeeCents: r.cesuFeeCents,
      netCents: r.netCents,
      receivedAt: r.receivedAt.toISOString(),
      late: isLate(r.receivedAt, now),
    }));
  }

  /** Two « Marquer versé » at once may take the same autofacture number: try again. */
  private async withNumberRetry<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
    for (let i = 1; ; i += 1) {
      try {
        return await run();
      } catch (error) {
        const collision = (error as { code?: string }).code === 'P2002';
        if (!collision || i >= attempts) throw error;
      }
    }
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
      statementId: r.statementId,
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
      statementId: null,
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
