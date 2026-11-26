import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { StripeService } from '../../integrations/stripe.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CommissionDebitsService,
  SEPA_CLAWBACK_WINDOW_DAYS,
  SEPA_MAX_AMOUNT_CENTS,
} from './commission-debits.service';

const ACTIVE_MANDATE = {
  status: 'active',
  stripeCustomerId: 'cus_1',
  stripePaymentMethodId: 'pm_1',
  stripeMandateId: 'mandate_1',
};

const ISSUED_INVOICE = {
  id: 'invoice-1',
  invoiceNumber: 'LF-COM-2026-0007',
  chefProfileId: 'chef-1',
  amountTtcCents: 1080,
  status: 'issued',
  chefProfile: { sepaMandate: ACTIVE_MANDATE },
};

const PENDING_DEBIT = {
  id: 'debit-1',
  commissionInvoiceId: 'invoice-1',
  amountTtcCents: 1080,
  status: 'pending',
  attemptNumber: 1,
  settledAt: null,
};

const CESU_COMMISSION = {
  id: 'commission-1',
  chefProfileId: 'chef-1',
  rateBps: 1500,
  vatRateBps: 2000,
  amountHtCents: 900,
  amountVatCents: 180,
  amountTtcCents: 1080,
  collectionMethod: 'sepa_direct_debit',
  payment: { method: 'cesu' },
};

describe('CommissionDebitsService', () => {
  let prisma: {
    commissionInvoice: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      count: jest.Mock;
      aggregate: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      findFirst: jest.Mock;
    };
    commissionDebit: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    commission: { findMany: jest.Mock; findUnique: jest.Mock; updateMany: jest.Mock };
    sepaMandate: { updateMany: jest.Mock };
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
  };
  let tx: typeof prisma;
  let stripeClient: { paymentIntents: { create: jest.Mock } };
  let stripe: { configured: boolean; getClient: jest.Mock };
  let service: CommissionDebitsService;
  let trigger: string;
  let legacyOn: boolean;

  beforeEach(() => {
    trigger = 'on_payment';
    legacyOn = true;
    prisma = {
      commissionInvoice: {
        findUnique: jest.fn().mockResolvedValue(ISSUED_INVOICE),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue(ISSUED_INVOICE),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        count: jest.fn().mockResolvedValue(6),
        // No credit note deducted by default (Recettes lot 6).
        aggregate: jest.fn().mockResolvedValue({ _sum: { amountTtcCents: null } }),
        findUniqueOrThrow: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      commissionDebit: {
        // No live debit and no orphan by default.
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(PENDING_DEBIT),
        create: jest.fn().mockResolvedValue(PENDING_DEBIT),
        update: jest.fn().mockResolvedValue(PENDING_DEBIT),
        count: jest.fn().mockResolvedValue(0),
      },
      commission: {
        findMany: jest.fn().mockResolvedValue([CESU_COMMISSION]),
        findUnique: jest
          .fn()
          .mockResolvedValue({ collectionMethod: 'sepa_direct_debit' }),
        updateMany: jest.fn(),
      },
      sepaMandate: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      $transaction: jest.fn((callback: (client: typeof prisma) => unknown) =>
        callback(tx),
      ),
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
    };
    tx = prisma;
    stripeClient = {
      paymentIntents: {
        create: jest.fn().mockResolvedValue({ id: 'pi_debit', status: 'processing' }),
      },
    };
    stripe = { configured: true, getClient: jest.fn(() => stripeClient) };

    const get = jest.fn((key: string, fallback?: unknown) => {
      if (key === 'payments.commissionDebitTrigger') return trigger;
      // These tests cover the former invoicing, switched on here.
      if (key === 'payments.legacyInvoicing') return legacyOn;
      if (key === 'payments.commissionDebitMaxAttempts') return 3;
      if (key === 'payments.commissionInvoicePrefix') return 'LF-COM';
      return fallback;
    });
    const config = { get, getOrThrow: get };

    service = new CommissionDebitsService(
      prisma as unknown as PrismaService,
      stripe as unknown as StripeService,
      config as unknown as ConfigService,
    );
  });

  describe('issueInvoiceForCommissions', () => {
    it('numbers the invoice and marks the commissions invoiced', async () => {
      const year = new Date().getUTCFullYear();

      await service.issueInvoiceForCommissions(['commission-1']);

      expect(prisma.commissionInvoice.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          chefProfileId: 'chef-1',
          invoiceNumber: `LF-COM-${year}-0007`,
          amountHtCents: 900,
          amountVatCents: 180,
          amountTtcCents: 1080,
          rateBps: 1500,
          vatRateBps: 2000,
          // What says whether the commission was already withheld or is still to collect.
          paymentMethod: 'cesu',
          collectionMethod: 'sepa_direct_debit',
          status: 'issued',
        }),
      });
      expect(prisma.commission.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['commission-1'] } },
        data: { status: 'invoiced', commissionInvoiceId: 'invoice-1' },
      });
    });

    it('refuses to bill several chefs on one invoice', async () => {
      prisma.commission.findMany.mockResolvedValue([
        CESU_COMMISSION,
        { ...CESU_COMMISSION, id: 'commission-2', chefProfileId: 'chef-2' },
      ]);

      await expect(
        service.issueInvoiceForCommissions(['commission-1', 'commission-2']),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses commissions that are already invoiced or collected at charge time', async () => {
      prisma.commission.findMany.mockResolvedValue([]);

      await expect(
        service.issueInvoiceForCommissions(['commission-1']),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('collectOutstanding', () => {
    it('debits every invoice still due, and one refusal does not stop the next', async () => {
      prisma.commissionInvoice.findMany.mockResolvedValue([
        { id: 'invoice-1', invoiceNumber: 'LF-COM-2026-0007' },
        { id: 'invoice-2', invoiceNumber: 'LF-COM-2026-0008' },
      ]);
      const debit = jest
        .spyOn(service, 'executeDebit')
        .mockRejectedValueOnce(new ConflictException('no attempt left'))
        .mockResolvedValueOnce({} as never);

      await service.collectOutstanding('chef-1');

      expect(prisma.commissionInvoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { chefProfileId: 'chef-1', status: 'issued', kind: 'invoice' },
        }),
      );
      expect(debit).toHaveBeenNthCalledWith(1, 'invoice-1');
      expect(debit).toHaveBeenNthCalledWith(2, 'invoice-2');
    });
  });

  describe('executeDebit', () => {
    it('is a direct charge: no on_behalf_of, transfer_data or application fee', async () => {
      // The platform is the seller on facture B, and `on_behalf_of` would invalidate the
      // mandate already collected by requiring a fresh authorisation.
      await service.executeDebit('invoice-1');

      const [params] = stripeClient.paymentIntents.create.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(params).not.toHaveProperty('on_behalf_of');
      expect(params).not.toHaveProperty('transfer_data');
      expect(params).not.toHaveProperty('application_fee_amount');
    });

    it('sends the mandate explicitly, off-session and confirmed, in euro', async () => {
      await service.executeDebit('invoice-1');

      expect(stripeClient.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 1080,
          currency: 'eur',
          customer: 'cus_1',
          payment_method: 'pm_1',
          mandate: 'mandate_1',
          payment_method_types: ['sepa_debit'],
          off_session: true,
          confirm: true,
          description: "Commission LAB'S FOOD LF-COM-2026-0007",
          metadata: expect.objectContaining({
            commissionInvoiceId: 'invoice-1',
            commissionDebitId: 'debit-1',
            chefProfileId: 'chef-1',
          }),
        }),
        { idempotencyKey: 'commission-debit-debit-1' },
      );
    });

    it('writes the debit row before calling Stripe', async () => {
      await service.executeDebit('invoice-1');

      const created = prisma.commissionDebit.create.mock.invocationCallOrder[0];
      const called = stripeClient.paymentIntents.create.mock.invocationCallOrder[0];
      expect(created).toBeLessThan(called);
    });

    it('resumes an interrupted attempt with its original idempotency key', async () => {
      // A crash between the Stripe call and persisting the intent id leaves a `pending`
      // row with no intent. Replaying the identical request returns the same
      // PaymentIntent instead of debiting the chef a second time.
      prisma.commissionDebit.findFirst.mockImplementation(
        (args: { where: { status?: unknown } }) =>
          Promise.resolve(
            (args.where as { stripePaymentIntentId?: unknown }).stripePaymentIntentId ===
              null
              ? { ...PENDING_DEBIT, id: 'debit-orphan' }
              : null,
          ),
      );

      await service.executeDebit('invoice-1');

      expect(prisma.commissionDebit.create).not.toHaveBeenCalled();
      expect(stripeClient.paymentIntents.create).toHaveBeenCalledWith(expect.anything(), {
        idempotencyKey: 'commission-debit-debit-orphan',
      });
    });

    it('records `processing` rather than waiting for a success SEPA never returns', async () => {
      await service.executeDebit('invoice-1');

      expect(prisma.commissionDebit.update).toHaveBeenCalledWith({
        where: { id: 'debit-1' },
        data: { stripePaymentIntentId: 'pi_debit' },
      });
      expect(prisma.commission.updateMany).toHaveBeenCalledWith({
        where: { commissionInvoiceId: 'invoice-1' },
        data: { status: 'processing' },
      });
    });

    it('debits the chef’s connected account as the customer on an Accounts v2 mandate', async () => {
      prisma.commissionInvoice.findUnique.mockResolvedValue({
        ...ISSUED_INVOICE,
        chefProfile: { sepaMandate: { ...ACTIVE_MANDATE, stripeCustomerId: 'acct_1' } },
      });

      await service.executeDebit('invoice-1');

      const [params, options] = stripeClient.paymentIntents.create.mock.calls[0] as [
        Record<string, unknown>,
        Record<string, unknown>,
      ];
      expect(params).toMatchObject({
        customer_account: 'acct_1',
        mandate: 'mandate_1',
        // Endive refuses `payment_method_types` with a 400.
        allowed_payment_method_types: ['sepa_debit'],
      });
      expect(params).not.toHaveProperty('customer');
      expect(params).not.toHaveProperty('payment_method_types');
      expect(options).toEqual({
        idempotencyKey: 'commission-debit-debit-1',
        apiVersion: '2026-09-30.endive',
      });
    });

    it('fails the attempt but keeps the invoice due when the chef has no mandate', async () => {
      prisma.commissionInvoice.findUnique.mockResolvedValue({
        ...ISSUED_INVOICE,
        chefProfile: { sepaMandate: null },
      });

      await service.executeDebit('invoice-1');

      expect(stripeClient.paymentIntents.create).not.toHaveBeenCalled();
      expect(prisma.commissionDebit.update).toHaveBeenCalledWith({
        where: { id: 'debit-1' },
        data: {
          status: 'failed',
          failureReason: expect.stringMatching(/no SEPA mandate/),
        },
      });
      expect(prisma.commissionInvoice.update).not.toHaveBeenCalled();
    });

    it('fails the attempt on a revoked mandate', async () => {
      prisma.commissionInvoice.findUnique.mockResolvedValue({
        ...ISSUED_INVOICE,
        chefProfile: { sepaMandate: { ...ACTIVE_MANDATE, status: 'revoked' } },
      });

      await service.executeDebit('invoice-1');

      expect(stripeClient.paymentIntents.create).not.toHaveBeenCalled();
      expect(prisma.commissionDebit.update).toHaveBeenCalledWith({
        where: { id: 'debit-1' },
        data: { status: 'failed', failureReason: expect.stringMatching(/revoked/) },
      });
    });

    it('refuses to send more than the 10 000 EUR SEPA per-transaction ceiling', async () => {
      prisma.commissionInvoice.findUnique.mockResolvedValue({
        ...ISSUED_INVOICE,
        amountTtcCents: SEPA_MAX_AMOUNT_CENTS + 1,
      });

      await service.executeDebit('invoice-1');

      expect(stripeClient.paymentIntents.create).not.toHaveBeenCalled();
      expect(prisma.commissionDebit.update).toHaveBeenCalledWith({
        where: { id: 'debit-1' },
        data: { status: 'failed', failureReason: expect.stringMatching(/10000 EUR/) },
      });
    });

    it('records a Stripe error as a failed attempt instead of throwing', async () => {
      stripeClient.paymentIntents.create.mockRejectedValue(
        new Error('No such payment method'),
      );

      await service.executeDebit('invoice-1');

      expect(prisma.commissionDebit.update).toHaveBeenCalledWith({
        where: { id: 'debit-1' },
        data: { status: 'failed', failureReason: 'No such payment method' },
      });
    });

    it('refuses a second debit while one is already under way', async () => {
      prisma.commissionDebit.findFirst.mockResolvedValue({
        ...PENDING_DEBIT,
        status: 'processing',
      });

      await expect(service.executeDebit('invoice-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(stripeClient.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('refuses to collect an invoice that is not issued', async () => {
      prisma.commissionInvoice.findUnique.mockResolvedValue({
        ...ISSUED_INVOICE,
        status: 'settled',
      });

      await expect(service.executeDebit('invoice-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('404s on an unknown invoice', async () => {
      prisma.commissionInvoice.findUnique.mockResolvedValue(null);

      await expect(service.executeDebit('ghost')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('retry (executeDebit on an already-attempted invoice)', () => {
    it('reuses the invoice, so no number is burnt on a retry', async () => {
      prisma.commissionDebit.count.mockResolvedValue(1);

      await service.executeDebit('invoice-1');

      expect(prisma.commissionInvoice.create).not.toHaveBeenCalled();
      expect(stripeClient.paymentIntents.create).toHaveBeenCalled();
    });

    it('refuses once the attempts are exhausted', async () => {
      prisma.commissionDebit.count.mockResolvedValue(3);

      await expect(service.executeDebit('invoice-1')).rejects.toMatchObject({
        response: { code: 'DEBIT_ATTEMPTS_EXHAUSTED' },
      });
      expect(stripeClient.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('lets an admin retry go past the ceiling: it is the decision the block waits for', async () => {
      prisma.commissionDebit.count.mockResolvedValue(3);

      await service.executeDebit('invoice-1', { overrideAttemptCeiling: true });

      expect(prisma.commissionDebit.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ attemptNumber: 4, status: 'pending' }),
      });
      expect(stripeClient.paymentIntents.create).toHaveBeenCalled();
    });

    it('refuses an admin retry with no active mandate, without recording an attempt', async () => {
      prisma.commissionDebit.count.mockResolvedValue(3);
      prisma.commissionInvoice.findUnique.mockResolvedValue({
        ...ISSUED_INVOICE,
        chefProfile: { sepaMandate: { ...ACTIVE_MANDATE, status: 'pending' } },
      });

      await expect(
        service.executeDebit('invoice-1', { overrideAttemptCeiling: true }),
      ).rejects.toMatchObject({ response: { code: 'DEBIT_NOT_POSSIBLE' } });
      expect(prisma.commissionDebit.create).not.toHaveBeenCalled();
      expect(stripeClient.paymentIntents.create).not.toHaveBeenCalled();
    });
  });

  describe('former invoicing switched off (« prix net »)', () => {
    it('neither invoices nor debits a commission as it falls due', async () => {
      legacyOn = false;
      await expect(service.onCommissionDue('commission-1')).resolves.toBeNull();
      expect(prisma.commissionInvoice.create).not.toHaveBeenCalled();
      expect(stripeClient.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('refuses a manual debit, a batch and an invoice with LEGACY_INVOICING_DISABLED', async () => {
      legacyOn = false;
      for (const call of [
        () => service.executeDebit('invoice-1'),
        () => service.issueInvoiceForCommissions(['commission-1']),
        () => service.runDueInvoices({ start: new Date(), end: new Date() }),
      ]) {
        await expect(call()).rejects.toMatchObject({
          response: expect.objectContaining({ code: 'LEGACY_INVOICING_DISABLED' }),
        });
      }
    });
  });

  describe('onCommissionDue', () => {
    it('invoices and debits immediately under the on_payment trigger', async () => {
      await service.onCommissionDue('commission-1');

      expect(prisma.commissionInvoice.create).toHaveBeenCalled();
      expect(stripeClient.paymentIntents.create).toHaveBeenCalled();
    });

    it('never invoices nor debits a part withheld at payout (« prix net »)', async () => {
      prisma.commission.findUnique.mockResolvedValue({
        collectionMethod: 'payout_withholding',
      });

      const result = await service.onCommissionDue('commission-1');

      expect(result).toBeNull();
      expect(prisma.commissionInvoice.create).not.toHaveBeenCalled();
      expect(stripeClient.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('leaves the commission pending under monthly_batch', async () => {
      trigger = 'monthly_batch';

      const result = await service.onCommissionDue('commission-1');

      expect(result).toBeNull();
      expect(prisma.commissionInvoice.create).not.toHaveBeenCalled();
    });

    it('never throws back at the CESU settlement that called it', async () => {
      // The chef already has the client's money; a Stripe outage on the platform's own
      // commission must not undo that settlement.
      stripeClient.paymentIntents.create.mockImplementation(() => {
        throw new Error('Stripe is down');
      });
      prisma.commissionInvoice.create.mockRejectedValue(new Error('Stripe is down'));

      await expect(service.onCommissionDue('commission-1')).resolves.toBeNull();
    });
  });

  describe('runDueInvoices', () => {
    const period = {
      start: new Date('2026-08-01T00:00:00.000Z'),
      end: new Date('2026-09-01T00:00:00.000Z'),
    };

    it('groups the period commissions into one invoice per chef', async () => {
      prisma.commission.findMany.mockResolvedValue([
        CESU_COMMISSION,
        { ...CESU_COMMISSION, id: 'commission-2' },
      ]);

      const result = await service.runDueInvoices(period);

      expect(prisma.commissionInvoice.create).toHaveBeenCalledTimes(1);
      expect(prisma.commissionInvoice.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          amountTtcCents: 2160,
          periodStart: period.start,
          periodEnd: period.end,
        }),
      });
      expect(result.invoicesIssued).toBe(1);
    });

    it('spreads the debits over the allowed target_date range', async () => {
      await service.runDueInvoices(period);

      const [params] = stripeClient.paymentIntents.create.mock.calls[0] as [
        { payment_method_options?: { sepa_debit?: { target_date?: string } } },
      ];
      expect(params.payment_method_options?.sepa_debit?.target_date).toMatch(
        /^\d{4}-\d{2}-\d{2}$/,
      );
    });

    it('does nothing when another instance holds the advisory lock', async () => {
      // Railway can run several instances; a second concurrent run must not double-invoice.
      prisma.$queryRaw.mockResolvedValue([{ locked: false }]);

      const result = await service.runDueInvoices(period);

      expect(result).toMatchObject({ invoicesIssued: 0, skipped: 'locked' });
      expect(prisma.commissionInvoice.create).not.toHaveBeenCalled();
    });
  });

  describe('webhook handlers', () => {
    it('records the 8-week SEPA CORE clawback deadline on success', async () => {
      await service.handleDebitSucceeded(PENDING_DEBIT as never);

      const [call] = prisma.commissionDebit.update.mock.calls as [
        [{ data: { settledAt: Date; clawbackWindowEndsAt: Date } }],
      ];
      const { settledAt, clawbackWindowEndsAt } = call[0].data;
      const days =
        (clawbackWindowEndsAt.getTime() - settledAt.getTime()) / (24 * 60 * 60 * 1000);
      expect(days).toBe(SEPA_CLAWBACK_WINDOW_DAYS);
      expect(prisma.commissionInvoice.update).toHaveBeenCalledWith({
        where: { id: 'invoice-1' },
        data: { status: 'settled' },
      });
    });

    it('keeps the receivable due when an attempt fails', async () => {
      await service.handleDebitFailed(
        PENDING_DEBIT as never,
        {
          last_payment_error: { message: 'insufficient_funds' },
        } as never,
      );

      expect(prisma.commission.updateMany).toHaveBeenCalledWith({
        where: { commissionInvoiceId: 'invoice-1' },
        data: { status: 'invoiced' },
      });
      // The invoice itself is untouched: a failed attempt is not a cancelled receivable.
      expect(prisma.commissionInvoice.update).not.toHaveBeenCalled();
    });

    it('reopens the invoice and reverses the commission on a dispute', async () => {
      await service.handleDebitDisputed({
        ...PENDING_DEBIT,
        status: 'succeeded',
      } as never);

      expect(prisma.commissionInvoice.update).toHaveBeenCalledWith({
        where: { id: 'invoice-1' },
        data: { status: 'issued' },
      });
      expect(prisma.commission.updateMany).toHaveBeenCalledWith({
        where: { commissionInvoiceId: 'invoice-1' },
        data: { status: 'reversed', collectedAt: null },
      });
    });

    it('restores the collection only when the dispute is won', async () => {
      await service.handleDebitDisputeClosed(
        { ...PENDING_DEBIT, status: 'reversed' } as never,
        {
          status: 'lost',
        } as never,
      );

      expect(prisma.commissionInvoice.update).not.toHaveBeenCalled();

      await service.handleDebitDisputeClosed(
        { ...PENDING_DEBIT, status: 'reversed' } as never,
        {
          status: 'won',
        } as never,
      );

      expect(prisma.commissionInvoice.update).toHaveBeenCalledWith({
        where: { id: 'invoice-1' },
        data: { status: 'settled' },
      });
    });

    it('revokes the mandate when Stripe reports it inactive', async () => {
      await service.handleMandateUpdated({
        id: 'mandate_1',
        status: 'inactive',
        payment_method: 'pm_1',
      } as never);

      expect(prisma.sepaMandate.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ status: { not: 'revoked' } }),
        data: { status: 'revoked' },
      });
    });

    it('leaves an active mandate alone', async () => {
      await service.handleMandateUpdated({ id: 'mandate_1', status: 'active' } as never);

      expect(prisma.sepaMandate.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('credit notes (Recettes lot 6, URSSAF status 120)', () => {
    it('never debits a credit note', async () => {
      prisma.commissionInvoice.findUnique.mockResolvedValue({
        ...ISSUED_INVOICE,
        kind: 'credit_note',
        chefProfile: { sepaMandate: null },
      });
      await expect(service.executeDebit('invoice-1')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'INVOICE_IS_CREDIT_NOTE' }),
      });
      expect(stripeClient.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('debits the invoice less the credit notes deducted from it', async () => {
      prisma.commissionInvoice.aggregate.mockResolvedValue({
        _sum: { amountTtcCents: 500 },
      });
      await service.executeDebit('invoice-1').catch(() => null);
      const sent = stripeClient.paymentIntents.create.mock.calls[0]?.[0] as
        { amount: number } | undefined;
      if (sent) expect(sent.amount).toBe(ISSUED_INVOICE.amountTtcCents - 500);
      expect(prisma.commissionDebit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amountTtcCents: ISSUED_INVOICE.amountTtcCents - 500,
          }),
        }),
      );
    });

    it('drops a commission not invoiced yet, and credits one already invoiced', async () => {
      const tx2 = {
        commission: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 'c1',
            status: 'pending',
            commissionInvoiceId: null,
          }),
          update: jest.fn(),
        },
        commissionInvoice: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
          count: jest.fn().mockResolvedValue(3),
        },
      };
      prisma.$transaction.mockImplementation((callback: (client: unknown) => unknown) =>
        callback(tx2),
      );
      expect(await service.creditCommission('c1', 'Statut 120')).toEqual({
        creditNote: null,
        dropped: true,
      });
      expect(tx2.commission.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { status: 'failed' },
      });

      tx2.commission.findUniqueOrThrow.mockResolvedValue({
        id: 'c2',
        status: 'collected',
        commissionInvoiceId: 'invoice-1',
        chefProfileId: 'chef-1',
        amountHtCents: 250,
        amountVatCents: 50,
        amountTtcCents: 300,
        rateBps: 1500,
        vatRateBps: 2000,
        collectionMethod: 'sepa_direct_debit',
      });
      tx2.commissionInvoice.create.mockImplementation(
        ({ data }: { data: unknown }) => data,
      );
      const { creditNote } = await service.creditCommission('c2', 'Statut 120');
      expect(creditNote).toMatchObject({
        kind: 'credit_note',
        amountTtcCents: 300,
        creditForCommissionId: 'c2',
        invoiceNumber: expect.stringMatching(/^LF-COM-\d{4}-0004$/),
      });
    });
  });
});
