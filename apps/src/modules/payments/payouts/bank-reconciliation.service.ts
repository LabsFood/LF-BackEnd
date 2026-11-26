import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { PrismaService } from '../../../prisma/prisma.service';
import { UsersService } from '../../users/users.service';
import { CesuPaymentsService } from '../cesu-payments.service';
import { bankFeedConfig, fetchCredits } from '../cesu-reconciliation/bank-feed';
import {
  matchTransfer,
  type OpenDeclaration,
} from '../cesu-reconciliation/match-transfer';
import { BANK_RECONCILIATION_KEY, ChefPayoutsService } from './chef-payouts.service';

/** How far back the first run reads, and the overlap kept with the last credit seen. */
const FIRST_RUN_DAYS = 30;
const OVERLAP_DAYS = 3;
const DAY_MS = 86_400_000;

export interface ReconciliationRun {
  at: string;
  configured: boolean;
  received: number;
  matched: number;
  exceptions: number;
}

/**
 * « Rapprocher maintenant »: reads the credits on the SAS bank account, settles every
 * CESU declaration a transfer pays (booking reference **and** amount), keeps the rest
 * as exceptions, then creates the payouts the settled money opens.
 */
@Injectable()
export class BankReconciliationService {
  private readonly logger = new Logger(BankReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly cesu: CesuPaymentsService,
    private readonly payouts: ChefPayoutsService,
  ) {}

  async run(adminClerkUserId: string, now = new Date()): Promise<ReconciliationRun> {
    const admin = await this.users.ensurePersistedFromClerk(adminClerkUserId);
    const config = bankFeedConfig();
    if (!config) {
      await this.payouts.sync();
      return this.save(admin.id, {
        at: now.toISOString(),
        configured: false,
        received: 0,
        matched: 0,
        exceptions: 0,
      });
    }

    const credits = await fetchCredits(config, await this.dateFrom(now)).catch(
      (error: unknown) => {
        this.logger.error({
          event: 'bank.read_failed',
          reason: error instanceof Error ? error.message : 'unknown',
        });
        throw new ServiceUnavailableException({
          code: 'BANK_FEED_UNAVAILABLE',
          message: 'The bank account could not be read. The consent may have expired.',
        });
      },
    );

    const known = await this.prisma.bankCredit.findMany({
      where: { transactionId: { in: credits.map((c) => c.transactionId) } },
      select: { transactionId: true },
    });
    const seen = new Set(known.map((k) => k.transactionId));
    const fresh = credits.filter((c) => !seen.has(c.transactionId));

    let open = await this.openDeclarations();
    let matched = 0;
    for (const credit of fresh) {
      const outcome = matchTransfer(credit, open);
      let paymentId = 'paymentId' in outcome ? outcome.paymentId : null;
      let kind: string = outcome.kind;
      if (outcome.kind === 'matched') {
        try {
          await this.cesu.settleFromBank(
            outcome.paymentId,
            admin.id,
            credit.transactionId,
          );
          open = open.filter((d) => d.paymentId !== outcome.paymentId);
          matched += 1;
        } catch (error) {
          // Settled a moment earlier by someone else: an exception to look at, not a crash.
          kind = 'settle_failed';
          this.logger.warn({
            event: 'bank.settle_failed',
            paymentId,
            reason: error instanceof Error ? error.message : 'unknown',
          });
        }
      } else if (outcome.kind !== 'amount_mismatch') {
        paymentId = null;
      }
      await this.prisma.bankCredit.create({
        data: {
          transactionId: credit.transactionId,
          bookedOn: new Date(credit.bookedOn || now.toISOString().slice(0, 10)),
          amountCents: credit.amountCents,
          label: credit.label.slice(0, 1000),
          outcome: kind,
          paymentId,
        },
      });
    }

    await this.payouts.sync();
    this.logger.log({ event: 'bank.reconciled', received: fresh.length, matched });
    return this.save(admin.id, {
      at: now.toISOString(),
      configured: true,
      received: fresh.length,
      matched,
      exceptions: fresh.length - matched,
    });
  }

  private async dateFrom(now: Date): Promise<string> {
    const last = await this.prisma.bankCredit.findFirst({
      orderBy: { bookedOn: 'desc' },
      select: { bookedOn: true },
    });
    const from = last
      ? new Date(last.bookedOn.getTime() - OVERLAP_DAYS * DAY_MS)
      : new Date(now.getTime() - FIRST_RUN_DAYS * DAY_MS);
    return from.toISOString().slice(0, 10);
  }

  private async openDeclarations(): Promise<OpenDeclaration[]> {
    const rows = await this.prisma.payment.findMany({
      where: {
        method: 'cesu',
        status: 'pending',
        purpose: 'service',
        cesuSettlement: { status: 'declared' },
      },
      select: { id: true, amountTtc: true, booking: { select: { reference: true } } },
    });
    return rows.map((r) => ({
      paymentId: r.id,
      bookingReference: r.booking.reference,
      amountCents: r.amountTtc,
    }));
  }

  private async save(
    adminUserId: string,
    run: ReconciliationRun,
  ): Promise<ReconciliationRun> {
    const value = { at: run.at, received: run.received, matched: run.matched };
    await this.prisma.platformSetting.upsert({
      where: { key: BANK_RECONCILIATION_KEY },
      update: { value, updatedByUserId: adminUserId },
      create: { key: BANK_RECONCILIATION_KEY, value, updatedByUserId: adminUserId },
    });
    return run;
  }
}
