import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Stripe from 'stripe';

import type { CommissionDebitTrigger } from '../../config/config.loader';
import type {
  CommissionDebit,
  CommissionInvoice,
  CommissionInvoiceStatus,
  Prisma,
} from '../../generated/prisma/client';
import { StripeService } from '../../integrations/stripe.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SEPA_CLAWBACK_WINDOW_DAYS } from './commission.util';
import { customerAccountOptions, customerRef } from './stripe-accounts-v2';

export { SEPA_CLAWBACK_WINDOW_DAYS };

/**
 * SEPA Direct Debit rejects anything above 10 000 € in a single transaction. A batch
 * covering a busy month can reach it, which is what `target_date` staggering is for.
 */
export const SEPA_MAX_AMOUNT_CENTS = 1_000_000;

/**
 * `target_date` accepts 3 to 15 days out. Batch debits are spread across that range so a
 * single chef's month does not arrive as one transaction near the 10 000 € ceiling.
 */
const TARGET_DATE_MIN_DAYS = 3;
const TARGET_DATE_MAX_DAYS = 15;

/**
 * Advisory-lock key for the batch run. Railway may run several instances of this API, so
 * "one invoice per chef per period" has to be enforced by Postgres, not by hoping only
 * one process calls the endpoint.
 */
const BATCH_LOCK_KEY = 8_452_119_001n;

/** Debit rows that mean the invoice already has collection under way. */
const LIVE_DEBIT_STATUSES = ['processing', 'succeeded'] as const;

/** Commissions the debit engine owns. Card commissions never reach it. */
const DEBITABLE_COMMISSION_STATUSES = ['pending'] as const;

/** Invoice plus everything the read endpoints render. */
export type CommissionInvoiceView = Prisma.CommissionInvoiceGetPayload<{
  include: {
    chefProfile: { select: { displayName: true } };
    debits: true;
    _count: { select: { commissions: true } };
  };
}>;

/** The frozen line fields an invoice sums. */
const COMMISSION_FOR_INVOICE_SELECT = {
  id: true,
  chefProfileId: true,
  rateBps: true,
  vatRateBps: true,
  amountHtCents: true,
  amountVatCents: true,
  amountTtcCents: true,
  collectionMethod: true,
  payment: { select: { method: true } },
} as const;

type CommissionForInvoice = {
  id: string;
  chefProfileId: string;
  rateBps: number;
  vatRateBps: number;
  amountHtCents: number;
  amountVatCents: number;
  amountTtcCents: number;
  collectionMethod: Prisma.CommissionGetPayload<object>['collectionMethod'];
  payment: { method: Prisma.PaymentGetPayload<object>['method'] };
};

/**
 * Issues **facture B** (the platform's commission invoice to the chef) and collects it by
 * SEPA direct debit.
 *
 * The order is not negotiable: **the invoice always precedes the debit**, because the
 * invoice is the legal basis the debit collects against. A failed debit therefore never
 * cancels the invoice — it adds an attempt against a receivable that stays due, which is
 * also why invoice numbers never develop holes.
 *
 * Everything about the outcome is learnt from **webhooks**, never from the API response:
 * `paymentIntents.create` on a SEPA debit answers `processing`, and a late failure shows
 * up days later as `requires_payment_method` (a PaymentIntent has no `failed` status).
 *
 * The debit is a **direct charge on the platform account**: the platform is the seller on
 * facture B. `on_behalf_of`, `transfer_data` and `application_fee_amount` are never sent
 * here — `on_behalf_of` in particular would invalidate the mandate already collected,
 * because Stripe then requires a fresh mandate authorisation.
 */
@Injectable()
export class CommissionDebitsService {
  private readonly logger = new Logger(CommissionDebitsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly config: ConfigService,
  ) {}

  // No fallbacks: Joi (env.validation.ts) defaults these and configLoader always sets them.
  get trigger(): CommissionDebitTrigger {
    return this.config.getOrThrow<CommissionDebitTrigger>(
      'payments.commissionDebitTrigger',
    );
  }

  get maxAttempts(): number {
    return this.config.getOrThrow<number>('payments.commissionDebitMaxAttempts');
  }

  private get invoicePrefix(): string {
    return this.config.getOrThrow<string>('payments.commissionInvoicePrefix');
  }

  /**
   * A commission has become due (its CESU payment was confirmed).
   *
   * `on_payment` bills and debits it immediately; `monthly_batch` leaves it `pending` for
   * `runDueInvoices()` to group. Both paths converge on `executeDebit()`, so switching
   * the trigger changes *when* an invoice is cut, never *how* it is collected.
   *
   * Never throws into the caller: the CESU payment is already settled and the chef has
   * the client's money — a Stripe outage on the platform's own commission must not undo
   * that. A failure leaves the invoice due and visible to an admin.
   */
  async onCommissionDue(commissionId: string): Promise<CommissionInvoice | null> {
    if (this.trigger !== 'on_payment') {
      return null;
    }
    try {
      const invoice = await this.issueInvoiceForCommissions([commissionId]);
      await this.executeDebit(invoice.id);
      return invoice;
    } catch (error) {
      this.logger.error(
        `Could not invoice or debit commission ${commissionId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return null;
    }
  }

  /**
   * A mandate has just become active: every facture B still `issued` for this chef is
   * debited now rather than waiting for the next trigger. One failure does not stop the
   * others — `executeDebit` already refuses an invoice with a debit in flight or with no
   * attempt left, and that refusal is only logged here.
   */
  async collectOutstanding(chefProfileId: string): Promise<void> {
    const invoices = await this.prisma.commissionInvoice.findMany({
      // A credit note is never debited: it is deducted (lot 6).
      where: { chefProfileId, status: 'issued', kind: 'invoice' },
      select: { id: true, invoiceNumber: true },
      orderBy: { issuedAt: 'asc' },
    });
    for (const invoice of invoices) {
      try {
        await this.executeDebit(invoice.id);
      } catch (error) {
        this.logger.warn({
          event: 'commission.collect_skipped',
          chefProfileId,
          invoiceNumber: invoice.invoiceNumber,
          reason: error instanceof Error ? error.message : 'unknown error',
        });
      }
    }
  }

  /**
   * Cuts one facture B covering the given commissions, all belonging to the same chef.
   *
   * Amounts are the sum of the frozen lines, not a recomputation: an invoice that did not
   * add up to the commissions it bills would be a bookkeeping problem, and the rate on a
   * line is the rate that was in force when it was created.
   */
  async issueInvoiceForCommissions(
    commissionIds: string[],
    period?: { start: Date; end: Date },
  ): Promise<CommissionInvoice> {
    if (commissionIds.length === 0) {
      throw new ConflictException('No commission to invoice.');
    }

    return this.withInvoiceNumberRetry(() =>
      this.prisma.$transaction(async (tx) => {
        const commissions = (await tx.commission.findMany({
          where: {
            id: { in: commissionIds },
            status: { in: [...DEBITABLE_COMMISSION_STATUSES] },
            collectionMethod: 'sepa_direct_debit',
          },
          select: COMMISSION_FOR_INVOICE_SELECT,
        })) as CommissionForInvoice[];

        if (commissions.length === 0) {
          throw new ConflictException(
            'These commissions are already invoiced, or are collected at charge time.',
          );
        }
        const chefProfileId = commissions[0].chefProfileId;
        if (commissions.some((line) => line.chefProfileId !== chefProfileId)) {
          throw new ConflictException(
            'A commission invoice bills exactly one chef; these commissions span several.',
          );
        }

        return this.createInvoice(tx, chefProfileId, commissions, period);
      }),
    );
  }

  /**
   * One collection attempt against a facture B.
   *
   * The `CommissionDebit` row is written **before** the Stripe call so its id can seed the
   * idempotency key. A crash between the call and persisting `stripePaymentIntentId`
   * leaves a `pending` row with no intent, and replaying it sends the identical request —
   * Stripe returns the same PaymentIntent instead of debiting the chef twice.
   *
   * A precondition failure (no mandate, revoked mandate, amount out of range) records a
   * failed attempt with an explicit reason. **The invoice stays due**; nothing is written
   * off automatically.
   *
   * `overrideAttemptCeiling` is the admin retry: the human decision the commission block
   * waits for (`commission-standing.ts`), so it may go past the ceiling. It is refused
   * outright when the debit cannot be sent — a retry with no active mandate would only add
   * one more failed attempt.
   */
  async executeDebit(
    invoiceId: string,
    options: { targetDateOffsetDays?: number; overrideAttemptCeiling?: boolean } = {},
  ): Promise<CommissionDebit> {
    const invoice = await this.prisma.commissionInvoice.findUnique({
      where: { id: invoiceId },
      include: { chefProfile: { include: { sepaMandate: true } } },
    });
    if (!invoice) {
      throw new NotFoundException(`Commission invoice ${invoiceId} not found.`);
    }
    if (invoice.kind === 'credit_note') {
      throw new ConflictException({
        code: 'INVOICE_IS_CREDIT_NOTE',
        message: `${invoice.invoiceNumber} is a credit note: it is deducted, never debited.`,
      });
    }
    if (invoice.status !== 'issued') {
      throw new ConflictException({
        code: 'INVOICE_NOT_ISSUED',
        message: `Commission invoice ${invoice.invoiceNumber} is ${invoice.status}; only an issued invoice is collected.`,
      });
    }

    const live = await this.prisma.commissionDebit.findFirst({
      where: {
        commissionInvoiceId: invoice.id,
        OR: [
          { status: { in: [...LIVE_DEBIT_STATUSES] } },
          // A `pending` row that already reached Stripe: the webhook has yet to land.
          { status: 'pending', stripePaymentIntentId: { not: null } },
        ],
      },
    });
    if (live) {
      throw new ConflictException({
        code: 'DEBIT_IN_PROGRESS',
        message: `A debit is already under way for commission invoice ${invoice.invoiceNumber}.`,
      });
    }

    const mandate = invoice.chefProfile.sepaMandate;
    if (options.overrideAttemptCeiling) {
      const blocked = this.checkPreconditions(invoice.amountTtcCents, mandate);
      if (blocked) {
        throw new ConflictException({ code: 'DEBIT_NOT_POSSIBLE', message: blocked });
      }
    }

    // Recettes lot 6: the credit notes deducted from this invoice lower the debit.
    const credited = await this.prisma.commissionInvoice.aggregate({
      where: { kind: 'credit_note', appliedToInvoiceId: invoice.id },
      _sum: { amountTtcCents: true },
    });
    const dueCents = Math.max(
      0,
      invoice.amountTtcCents - (credited._sum.amountTtcCents ?? 0),
    );
    const debit = await this.claimDebit(
      invoice.id,
      dueCents,
      options.overrideAttemptCeiling ?? false,
    );

    const precondition = this.checkPreconditions(dueCents, mandate);
    if (precondition) {
      return this.failDebit(debit, precondition);
    }
    if (!this.stripe.configured) {
      return this.failDebit(
        debit,
        'Stripe is not configured (STRIPE_SECRET_KEY missing).',
      );
    }

    let intent: Stripe.PaymentIntent;
    try {
      intent = await this.stripe.getClient().paymentIntents.create(
        {
          amount: dueCents,
          // SEPA Direct Debit settles in euro only.
          currency: 'eur',
          ...customerRef(mandate!.stripeCustomerId!),
          payment_method: mandate!.stripePaymentMethodId!,
          // Naming the mandate makes the debit deterministic instead of letting Stripe
          // pick among the customer's mandates.
          mandate: mandate!.stripeMandateId ?? undefined,
          payment_method_types: ['sepa_debit'],
          ...(options.targetDateOffsetDays
            ? {
                payment_method_options: {
                  sepa_debit: { target_date: targetDate(options.targetDateOffsetDays) },
                },
              }
            : {}),
          off_session: true,
          // Mandatory alongside `off_session` — there is nobody to confirm client-side.
          confirm: true,
          description: `Commission LAB'S FOOD ${invoice.invoiceNumber}`,
          metadata: {
            commissionInvoiceId: invoice.id,
            commissionDebitId: debit.id,
            chefProfileId: invoice.chefProfileId,
          },
          // Never on_behalf_of / transfer_data / application_fee_amount: the platform is
          // the seller on facture B, and on_behalf_of would invalidate the collected
          // mandate by requiring a fresh authorisation.
        },
        {
          idempotencyKey: `commission-debit-${debit.id}`,
          // `customer_account` is only understood from this API version on.
          ...(mandate!.stripeCustomerId!.startsWith('acct_')
            ? customerAccountOptions
            : {}),
        },
      );
    } catch (error) {
      return this.failDebit(
        debit,
        error instanceof Error ? error.message : 'Stripe rejected the debit.',
      );
    }

    return this.applyIntentStatus(debit.id, intent);
  }

  /**
   * `monthly_batch`: group every still-`pending` direct-debit commission into one invoice
   * per chef for the period, then debit each invoice.
   *
   * Guarded by a Postgres **advisory lock** held for the duration of the grouping
   * transaction: Railway can run several instances, and two concurrent runs would cut two
   * invoices for the same commissions. The lock covers the invoicing only — the Stripe
   * calls happen after it is released, since each debit is independently idempotent.
   */
  async runDueInvoices(period: { start: Date; end: Date }): Promise<{
    invoicesIssued: number;
    debitsStarted: number;
    invoiceNumbers: string[];
    skipped: 'locked' | null;
  }> {
    const invoices = await this.prisma.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${BATCH_LOCK_KEY}) AS locked
      `;
      if (!lock?.locked) {
        return null;
      }

      const due = await tx.commission.findMany({
        where: {
          status: { in: [...DEBITABLE_COMMISSION_STATUSES] },
          collectionMethod: 'sepa_direct_debit',
          commissionInvoiceId: null,
          payment: { status: 'succeeded', paidAt: { gte: period.start, lt: period.end } },
        },
        select: COMMISSION_FOR_INVOICE_SELECT,
      });

      const byChef = new Map<string, CommissionForInvoice[]>();
      for (const line of due as CommissionForInvoice[]) {
        const bucket = byChef.get(line.chefProfileId);
        if (bucket) bucket.push(line);
        else byChef.set(line.chefProfileId, [line]);
      }

      const issued: CommissionInvoice[] = [];
      for (const [chefProfileId, lines] of byChef) {
        issued.push(await this.createInvoice(tx, chefProfileId, lines, period));
      }
      return issued;
    });

    if (invoices === null) {
      this.logger.warn('Another instance is already running the commission batch.');
      return {
        invoicesIssued: 0,
        debitsStarted: 0,
        invoiceNumbers: [],
        skipped: 'locked',
      };
    }

    let debitsStarted = 0;
    for (const [index, invoice] of invoices.entries()) {
      try {
        // Spread the debits across the allowed `target_date` range so a busy month does
        // not land as one transaction against the 10 000 € per-transaction ceiling.
        await this.executeDebit(invoice.id, {
          targetDateOffsetDays:
            TARGET_DATE_MIN_DAYS +
            (index % (TARGET_DATE_MAX_DAYS - TARGET_DATE_MIN_DAYS + 1)),
        });
        debitsStarted += 1;
      } catch (error) {
        this.logger.error(
          `Could not start the debit for ${invoice.invoiceNumber}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }

    return {
      invoicesIssued: invoices.length,
      debitsStarted,
      invoiceNumbers: invoices.map((invoice) => invoice.invoiceNumber),
      skipped: null,
    };
  }

  /** `GET /me/chef/commission-invoices` — what the chef owes, and where each debit stands. */
  async listInvoicesForChef(chefProfileId: string): Promise<CommissionInvoiceView[]> {
    return this.loadInvoices({ chefProfileId });
  }

  /** `GET /admin/commission-invoices`, optionally narrowed to one status. */
  async listInvoicesForAdmin(
    status?: CommissionInvoiceStatus,
  ): Promise<CommissionInvoiceView[]> {
    return this.loadInvoices(status ? { status } : {});
  }

  private async loadInvoices(
    where: Prisma.CommissionInvoiceWhereInput,
  ): Promise<CommissionInvoiceView[]> {
    return this.prisma.commissionInvoice.findMany({
      where,
      include: {
        chefProfile: { select: { displayName: true } },
        debits: { orderBy: { createdAt: 'asc' } },
        _count: { select: { commissions: true } },
      },
      orderBy: { issuedAt: 'desc' },
    });
  }

  /** Webhook routing key: is this PaymentIntent a commission debit or a client payment? */
  findDebitByPaymentIntentId(paymentIntentId: string): Promise<CommissionDebit | null> {
    return this.prisma.commissionDebit.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
    });
  }

  /** `payment_intent.processing` — the debit is on its way to the chef's bank. */
  async handleDebitProcessing(debit: CommissionDebit): Promise<void> {
    if (debit.status !== 'pending') {
      return;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.commissionDebit.update({
        where: { id: debit.id },
        data: { status: 'processing' },
      });
      await tx.commission.updateMany({
        where: { commissionInvoiceId: debit.commissionInvoiceId },
        data: { status: 'processing' },
      });
    });
  }

  /**
   * `payment_intent.succeeded` on a commission debit. Records the clawback deadline: the
   * money is in, but under SEPA CORE it can still leave for another eight weeks.
   */
  async handleDebitSucceeded(debit: CommissionDebit): Promise<void> {
    if (debit.status === 'succeeded') {
      return;
    }
    await this.markSettled(debit, new Date());
    this.logger.log(`Commission debit ${debit.id} settled.`);
  }

  /**
   * `payment_intent.payment_failed` on a commission debit — which for SEPA means the
   * intent fell back to `requires_payment_method`, days after it was accepted.
   *
   * The commission returns to `invoiced`, not `failed`: it is still owed. Only the
   * attempt failed.
   */
  async handleDebitFailed(
    debit: CommissionDebit,
    intent: Stripe.PaymentIntent,
  ): Promise<void> {
    if (debit.status === 'failed' || debit.status === 'succeeded') {
      return;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.commissionDebit.update({
        where: { id: debit.id },
        data: {
          status: 'failed',
          failureReason:
            intent.last_payment_error?.message ?? 'Stripe reported a failed SEPA debit.',
        },
      });
      await tx.commission.updateMany({
        where: { commissionInvoiceId: debit.commissionInvoiceId },
        data: { status: 'invoiced' },
      });
    });
    this.logger.warn(`Commission debit ${debit.id} failed; the invoice stays due.`);
  }

  /**
   * `charge.dispute.created` on a commission debit — the SEPA CORE "no questions asked"
   * revocation. The bank has already honoured it, so this is bookkeeping plus an alert:
   * the receivable reopens and, through `findCommissionBlock`, the chef stops receiving
   * new bookings until it is settled.
   */
  async handleDebitDisputed(debit: CommissionDebit): Promise<void> {
    if (debit.status === 'reversed') {
      return;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.commissionDebit.update({
        where: { id: debit.id },
        data: { status: 'reversed' },
      });
      await tx.commissionInvoice.update({
        where: { id: debit.commissionInvoiceId },
        data: { status: 'issued' },
      });
      await tx.commission.updateMany({
        where: { commissionInvoiceId: debit.commissionInvoiceId },
        data: { status: 'reversed', collectedAt: null },
      });
    });
    this.logger.error(
      `ADMIN ACTION REQUIRED — commission debit ${debit.id} was reversed by a SEPA ` +
        'dispute. The invoice is due again and the chef is blocked from new bookings.',
    );
  }

  /** `charge.dispute.closed`. Only a dispute the platform *won* restores the collection. */
  async handleDebitDisputeClosed(
    debit: CommissionDebit,
    dispute: Stripe.Dispute,
  ): Promise<void> {
    if (dispute.status !== 'won') {
      this.logger.warn(
        `Dispute on commission debit ${debit.id} closed as ${dispute.status}; the invoice stays due.`,
      );
      return;
    }
    await this.markSettled(debit, debit.settledAt ?? new Date());
  }

  /**
   * Debit collected: the invoice closes, the lines are `collected`, and the clawback
   * deadline is stamped — the money is in, but SEPA CORE can still take it back for eight
   * weeks. Shared by `payment_intent.succeeded` and by a dispute the platform won.
   */
  private async markSettled(debit: CommissionDebit, settledAt: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.commissionDebit.update({
        where: { id: debit.id },
        data: {
          status: 'succeeded',
          settledAt,
          clawbackWindowEndsAt: addDays(settledAt, SEPA_CLAWBACK_WINDOW_DAYS),
          failureReason: null,
        },
      });
      await tx.commissionInvoice.update({
        where: { id: debit.commissionInvoiceId },
        data: { status: 'settled' },
      });
      await tx.commission.updateMany({
        where: { commissionInvoiceId: debit.commissionInvoiceId },
        data: { status: 'collected', collectedAt: settledAt },
      });
    });
  }

  /** `mandate.updated`: an inactive mandate can no longer carry a debit. */
  async handleMandateUpdated(mandate: Stripe.Mandate): Promise<void> {
    if (mandate.status === 'active') {
      return;
    }
    const paymentMethodId =
      typeof mandate.payment_method === 'string'
        ? mandate.payment_method
        : mandate.payment_method?.id;
    const updated = await this.prisma.sepaMandate.updateMany({
      where: {
        OR: [
          { stripeMandateId: mandate.id },
          ...(paymentMethodId ? [{ stripePaymentMethodId: paymentMethodId }] : []),
        ],
        status: { not: 'revoked' },
      },
      data: { status: 'revoked' },
    });
    if (updated.count > 0) {
      this.logger.warn(
        `SEPA mandate ${mandate.id} is ${mandate.status}; the chef can no longer be debited.`,
      );
    }
  }

  /**
   * Either the orphan of an interrupted attempt — a `pending` row whose Stripe call never
   * reported back — or a fresh attempt. Resuming the orphan is what makes the replay
   * idempotent: the same key produces the same PaymentIntent.
   */
  private async claimDebit(
    commissionInvoiceId: string,
    amountTtcCents: number,
    overrideCeiling: boolean,
  ): Promise<CommissionDebit> {
    const orphan = await this.prisma.commissionDebit.findFirst({
      where: { commissionInvoiceId, status: 'pending', stripePaymentIntentId: null },
      orderBy: { createdAt: 'desc' },
    });
    if (orphan) {
      // A replay of an attempt that is already counted, not a new one — so it is not
      // held against the ceiling.
      this.logger.warn(
        `Resuming interrupted commission debit ${orphan.id} with its original idempotency key.`,
      );
      return orphan;
    }

    const attempts = await this.prisma.commissionDebit.count({
      where: { commissionInvoiceId },
    });
    if (attempts >= this.maxAttempts && !overrideCeiling) {
      throw new ConflictException({
        code: 'DEBIT_ATTEMPTS_EXHAUSTED',
        message:
          `Commission invoice ${commissionInvoiceId} has used its ${this.maxAttempts} debit ` +
          'attempts. An admin retry goes past the ceiling once the mandate is active; ' +
          'otherwise settle it out of band — the chef is blocked from new bookings until then.',
      });
    }
    return this.prisma.commissionDebit.create({
      data: {
        commissionInvoiceId,
        amountTtcCents,
        status: 'pending',
        attemptNumber: attempts + 1,
        initiatedAt: new Date(),
      },
    });
  }

  /** Returns an explicit reason, or `null` when the debit may be sent. */
  private checkPreconditions(
    amountTtcCents: number,
    mandate: {
      status: string;
      stripeCustomerId: string | null;
      stripePaymentMethodId: string | null;
    } | null,
  ): string | null {
    if (!mandate) {
      return 'The chef has no SEPA mandate; the commission cannot be debited.';
    }
    if (mandate.status !== 'active') {
      return `The chef SEPA mandate is ${mandate.status}; the commission cannot be debited.`;
    }
    if (!mandate.stripeCustomerId || !mandate.stripePaymentMethodId) {
      return 'The chef SEPA mandate is incomplete (no Stripe customer or payment method).';
    }
    if (amountTtcCents <= 0) {
      return 'A debit must be greater than zero.';
    }
    if (amountTtcCents > SEPA_MAX_AMOUNT_CENTS) {
      return `SEPA Direct Debit is capped at ${SEPA_MAX_AMOUNT_CENTS / 100} EUR per transaction.`;
    }
    return null;
  }

  private async failDebit(
    debit: CommissionDebit,
    failureReason: string,
  ): Promise<CommissionDebit> {
    this.logger.warn(`Commission debit ${debit.id} failed: ${failureReason}`);
    return this.prisma.commissionDebit.update({
      where: { id: debit.id },
      data: { status: 'failed', failureReason },
    });
  }

  /**
   * SEPA never answers `succeeded` synchronously — `processing` is the expected outcome,
   * and everything final arrives by webhook. This only records what the API did say.
   */
  private async applyIntentStatus(
    debitId: string,
    intent: Stripe.PaymentIntent,
  ): Promise<CommissionDebit> {
    const debit = await this.prisma.commissionDebit.update({
      where: { id: debitId },
      data: { stripePaymentIntentId: intent.id },
    });

    switch (intent.status) {
      case 'processing':
        await this.handleDebitProcessing(debit);
        break;
      case 'succeeded':
        await this.handleDebitSucceeded(debit);
        break;
      case 'requires_payment_method':
        await this.handleDebitFailed(debit, intent);
        break;
      case 'canceled':
        await this.prisma.commissionDebit.update({
          where: { id: debit.id },
          data: { status: 'canceled' },
        });
        break;
      default:
        this.logger.warn(
          `Commission debit ${debit.id}: unexpected PaymentIntent status ${intent.status}.`,
        );
    }

    return (
      (await this.prisma.commissionDebit.findUnique({ where: { id: debit.id } })) ?? debit
    );
  }

  /**
   * The one writer of a `CommissionInvoice` and of the `invoiced` transition on the lines
   * it bills, shared by the single-commission and batch paths. Rates come from the first
   * line rather than being recomputed: lines on one invoice share a rate in practice, and
   * if a rate change ever straddles a batch the per-line `Commission` rows stay the
   * authoritative record.
   */
  private async createInvoice(
    tx: Pick<Prisma.TransactionClient, 'commissionInvoice' | 'commission'>,
    chefProfileId: string,
    lines: CommissionForInvoice[],
    period?: { start: Date; end: Date },
  ): Promise<CommissionInvoice> {
    const invoice = await tx.commissionInvoice.create({
      data: {
        chefProfileId,
        invoiceNumber: await this.nextInvoiceNumber(tx),
        issuedAt: new Date(),
        amountHtCents: sum(lines, (line) => line.amountHtCents),
        amountVatCents: sum(lines, (line) => line.amountVatCents),
        amountTtcCents: sum(lines, (line) => line.amountTtcCents),
        rateBps: lines[0].rateBps,
        vatRateBps: lines[0].vatRateBps,
        paymentMethod: lines[0].payment.method,
        collectionMethod: lines[0].collectionMethod,
        status: 'issued',
        ...(period ? { periodStart: period.start, periodEnd: period.end } : {}),
      },
    });
    await tx.commission.updateMany({
      where: { id: { in: lines.map((line) => line.id) } },
      data: { status: 'invoiced', commissionInvoiceId: invoice.id },
    });
    return this.deductCredits(tx, invoice);
  }

  /**
   * Recettes lot 6: the chef's open credit notes are deducted from their next facture B,
   * oldest first, as far as it goes. Covered whole, the invoice is settled at once and
   * nothing is debited.
   */
  private async deductCredits(
    tx: Pick<Prisma.TransactionClient, 'commissionInvoice'>,
    invoice: CommissionInvoice,
  ): Promise<CommissionInvoice> {
    const open = await tx.commissionInvoice.findMany({
      where: {
        chefProfileId: invoice.chefProfileId,
        kind: 'credit_note',
        status: 'issued',
        appliedToInvoiceId: null,
        refundedAt: null,
      },
      orderBy: { issuedAt: 'asc' },
    });
    let left = invoice.amountTtcCents;
    const applied: string[] = [];
    for (const note of open) {
      if (note.amountTtcCents > left) break;
      left -= note.amountTtcCents;
      applied.push(note.id);
    }
    if (!applied.length) return invoice;
    await tx.commissionInvoice.updateMany({
      where: { id: { in: applied } },
      data: { appliedToInvoiceId: invoice.id, status: 'settled' },
    });
    if (left > 0) return invoice;
    return tx.commissionInvoice.update({
      where: { id: invoice.id },
      data: { status: 'settled' },
    });
  }

  /**
   * Recettes lot 6: URSSAF took a prestation back (status 120). Its commission goes back
   * to the chef: never invoiced yet, it is simply dropped; invoiced or collected, a
   * credit note in the facture B sequence, deducted from the next one (or paid back by
   * hand when there is none: `refundedAt`).
   */
  async creditCommission(commissionId: string, reason: string) {
    return this.withInvoiceNumberRetry(() =>
      this.prisma.$transaction(async (tx) => {
        const commission = await tx.commission.findUniqueOrThrow({
          where: { id: commissionId },
        });
        if (commission.status === 'pending' && !commission.commissionInvoiceId) {
          await tx.commission.update({
            where: { id: commission.id },
            data: { status: 'failed' },
          });
          return { creditNote: null, dropped: true };
        }
        const existing = await tx.commissionInvoice.findFirst({
          where: { kind: 'credit_note', creditForCommissionId: commission.id },
        });
        if (existing) return { creditNote: existing, dropped: false };
        const creditNote = await tx.commissionInvoice.create({
          data: {
            chefProfileId: commission.chefProfileId,
            kind: 'credit_note',
            invoiceNumber: await this.nextInvoiceNumber(tx),
            issuedAt: new Date(),
            amountHtCents: commission.amountHtCents,
            amountVatCents: commission.amountVatCents,
            amountTtcCents: commission.amountTtcCents,
            rateBps: commission.rateBps,
            vatRateBps: commission.vatRateBps,
            paymentMethod: 'avance_immediate',
            collectionMethod: commission.collectionMethod,
            status: 'issued',
            creditForCommissionId: commission.id,
            creditReason: reason,
          },
        });
        return { creditNote, dropped: false };
      }),
    );
  }

  /** An open credit note with no facture B to deduct it from, paid back by hand. */
  async markCreditRefunded(creditNoteId: string) {
    const { count } = await this.prisma.commissionInvoice.updateMany({
      where: {
        id: creditNoteId,
        kind: 'credit_note',
        status: 'issued',
        appliedToInvoiceId: null,
      },
      data: { status: 'settled', refundedAt: new Date() },
    });
    if (count !== 1) {
      throw new ConflictException({
        code: 'CREDIT_NOTE_NOT_OPEN',
        message: 'This credit note is already deducted or paid back.',
      });
    }
    return this.prisma.commissionInvoice.findUniqueOrThrow({
      where: { id: creditNoteId },
    });
  }

  /** `LF-COM-<year>-NNNN`, the one numbering scheme for facture B. */
  private async nextInvoiceNumber(
    tx: Pick<Prisma.TransactionClient, 'commissionInvoice'>,
  ): Promise<string> {
    const prefix = `${this.invoicePrefix}-${new Date().getUTCFullYear()}-`;
    const count = await tx.commissionInvoice.count({
      where: { invoiceNumber: { startsWith: prefix } },
    });
    return `${prefix}${String(count + 1).padStart(4, '0')}`;
  }

  /**
   * Counting invoices to number the next one races with a concurrent issue. The unique
   * index is what actually enforces the sequence; this retries the loser rather than
   * failing a legitimate invoice.
   */
  private async withInvoiceNumberRetry<T>(run: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        if (!isUniqueViolation(error) || attempt === 2) {
          throw error;
        }
      }
    }
    /* c8 ignore next */
    throw new ServiceUnavailableException(
      'Could not allocate a commission invoice number.',
    );
  }
}

function sum<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

/** `target_date` is a plain `YYYY-MM-DD` day, not a timestamp. */
function targetDate(offsetDays: number): string {
  return addDays(new Date(), offsetDays).toISOString().slice(0, 10);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  );
}
