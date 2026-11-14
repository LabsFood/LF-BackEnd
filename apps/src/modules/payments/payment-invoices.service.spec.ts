import { UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Prisma } from '../../generated/prisma/client';
import { SupabaseService } from '../../integrations/supabase.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import type { PaymentInvoiceSnapshot } from './payment-invoice-document';
import { PaymentInvoicesService } from './payment-invoices.service';

const PAID_AT = new Date('2026-11-02T10:00:00.000Z');

const PAYMENT = {
  id: 'payment-1',
  amountTtc: 20_000,
  currency: 'EUR',
  booking: {
    id: 'booking-1',
    reference: 'LF-2026-0042',
    startsAt: new Date('2026-11-05T09:00:00.000Z'),
    amountTtc: 20_000,
    priceCents: 18_500,
    shoppingFeeCents: 1_500,
    extraPersonsCents: 0,
    extraMealsCents: 0,
    addressLine: '12 rue de la Paix',
    addressPostalCode: '69002',
    addressCity: 'Lyon',
    serviceOffer: { name: 'Batch cooking 4 repas' },
    client: { id: 'client-1', fullName: 'Marie Dupont', email: 'marie@example.com' },
    chefProfile: {
      id: 'chef-1',
      displayName: 'Chef Amina',
      city: 'Lyon',
      sapDeclarationNumber: null,
    },
  },
};

describe('PaymentInvoicesService', () => {
  let tx: {
    paymentInvoice: { findUnique: jest.Mock; count: jest.Mock; create: jest.Mock };
    payment: { findUniqueOrThrow: jest.Mock };
  };
  let prisma: {
    paymentInvoice: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
    };
    payment: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let bucket: { upload: jest.Mock; createSignedUrl: jest.Mock };
  let supabase: { configured: boolean; getClient: jest.Mock };
  let service: PaymentInvoicesService;

  beforeEach(() => {
    tx = {
      paymentInvoice: {
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(6),
        create: jest.fn(({ data }: { data: { invoiceNumber: string } }) =>
          Promise.resolve({ id: 'invoice-1', invoiceNumber: data.invoiceNumber }),
        ),
      },
      payment: { findUniqueOrThrow: jest.fn().mockResolvedValue(PAYMENT) },
    };
    prisma = {
      paymentInvoice: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      payment: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    bucket = {
      upload: jest.fn().mockResolvedValue({ error: null }),
      createSignedUrl: jest
        .fn()
        .mockResolvedValue({ data: { signedUrl: 'https://signed' }, error: null }),
    };
    supabase = {
      configured: true,
      getClient: jest.fn(() => ({ storage: { from: () => bucket } })),
    };
    const get = jest.fn((_key: string, fallback?: unknown) => fallback);

    service = new PaymentInvoicesService(
      prisma as unknown as PrismaService,
      supabase as unknown as SupabaseService,
      {
        ensurePersistedFromClerk: jest.fn().mockResolvedValue({ id: 'client-1' }),
      } as unknown as UsersService,
      { get } as unknown as ConfigService,
    );
  });

  const asTx = () => tx as unknown as Prisma.TransactionClient;

  describe('issue', () => {
    afterEach(() => jest.useRealTimers());

    it("numbers the year's next invoice and freezes what the PDF shows", async () => {
      jest.useFakeTimers().setSystemTime(PAID_AT);

      const result = await service.issue(asTx(), 'payment-1', PAID_AT);

      expect(result).toEqual({ id: 'invoice-1', invoiceNumber: 'LF-CUS26-00007' });
      expect(tx.paymentInvoice.count).toHaveBeenCalledWith({
        where: { invoiceNumber: { startsWith: 'LF-CUS26-' } },
      });
      const { data } = tx.paymentInvoice.create.mock.calls[0][0] as {
        data: { snapshot: PaymentInvoiceSnapshot } & Record<string, unknown>;
      };
      expect(data).toMatchObject({
        paymentId: 'payment-1',
        bookingId: 'booking-1',
        clientId: 'client-1',
        chefProfileId: 'chef-1',
        amountTtcCents: 20_000,
        issuedAt: PAID_AT,
      });
      expect(data.snapshot).toMatchObject({
        invoiceNumber: 'LF-CUS26-00007',
        seller: { displayName: 'Chef Amina' },
        client: { name: 'Marie Dupont' },
        booking: { address: '12 rue de la Paix, 69002 Lyon' },
        lines: [
          { label: 'Batch cooking 4 repas', amountCents: 18_500 },
          { label: 'Forfait courses', amountCents: 1_500 },
        ],
      });
    });

    it('dates a late invoice the day it is issued, in that year, with the real payment date', async () => {
      const today = new Date('2027-01-15T09:00:00.000Z');
      jest.useFakeTimers().setSystemTime(today);

      const result = await service.issue(asTx(), 'payment-1', PAID_AT);

      expect(result.invoiceNumber).toBe('LF-CUS27-00007');
      expect(tx.paymentInvoice.count).toHaveBeenCalledWith({
        where: { invoiceNumber: { startsWith: 'LF-CUS27-' } },
      });
      const { data } = tx.paymentInvoice.create.mock.calls[0][0] as {
        data: { issuedAt: Date; snapshot: PaymentInvoiceSnapshot };
      };
      expect(data.issuedAt).toEqual(today);
      expect(data.snapshot).toMatchObject({
        issuedAt: today.toISOString(),
        paidAt: PAID_AT.toISOString(),
      });
    });

    it('hands back the existing invoice on a replay instead of numbering a second one', async () => {
      tx.paymentInvoice.findUnique.mockResolvedValue({
        id: 'invoice-1',
        invoiceNumber: 'LF-CUS26-00003',
      });

      const result = await service.issue(asTx(), 'payment-1', PAID_AT);

      expect(result.invoiceNumber).toBe('LF-CUS26-00003');
      expect(tx.paymentInvoice.create).not.toHaveBeenCalled();
    });
  });

  describe('backfill', () => {
    const PAST = [
      { id: 'payment-a', paidAt: new Date('2026-03-01T10:00:00.000Z') },
      { id: 'payment-b', paidAt: new Date('2026-04-01T10:00:00.000Z') },
      { id: 'payment-c', paidAt: new Date('2026-05-01T10:00:00.000Z') },
    ];
    let issue: jest.SpyInstance;
    let archive: jest.SpyInstance;

    beforeEach(() => {
      prisma.payment.findMany.mockResolvedValue(PAST);
      let sequence = 0;
      issue = jest.spyOn(service, 'issue').mockImplementation(() => {
        sequence += 1;
        return Promise.resolve({
          id: `invoice-${sequence}`,
          invoiceNumber: `LF-CUS26-0000${sequence}`,
        });
      });
      archive = jest.spyOn(service, 'archive').mockResolvedValue();
    });

    it('looks for settled card payments that have no invoice, oldest first', async () => {
      await service.backfill(true);

      expect(prisma.payment.findMany).toHaveBeenCalledWith({
        where: {
          method: 'cb',
          status: 'succeeded',
          paidAt: { not: null },
          invoice: null,
        },
        orderBy: { paidAt: 'asc' },
        select: { id: true, paidAt: true },
      });
    });

    it('reports what it would invoice on a dry run, and issues nothing', async () => {
      const result = await service.backfill(true);

      expect(result).toEqual({
        dryRun: true,
        pending: 3,
        issued: [],
        failed: [],
      });
      expect(issue).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('issues each in its own transaction with its real payment date, then stores it', async () => {
      const result = await service.backfill(false);

      expect(
        issue.mock.calls.map(([, paymentId, paidAt]) => [paymentId, paidAt]),
      ).toEqual(PAST.map((payment) => [payment.id, payment.paidAt]));
      expect(prisma.$transaction).toHaveBeenCalledTimes(3);
      expect(archive.mock.calls).toEqual([['invoice-1'], ['invoice-2'], ['invoice-3']]);
      expect(result.issued).toEqual([
        { paymentId: 'payment-a', invoiceNumber: 'LF-CUS26-00001' },
        { paymentId: 'payment-b', invoiceNumber: 'LF-CUS26-00002' },
        { paymentId: 'payment-c', invoiceNumber: 'LF-CUS26-00003' },
      ]);
    });

    it('reports a payment it cannot invoice and carries on with the next', async () => {
      issue.mockRejectedValueOnce(
        new UnprocessableEntityException({
          code: 'INVOICE_AMOUNT_INVALID',
          message: '…',
        }),
      );

      const result = await service.backfill(false);

      expect(result.failed).toEqual([
        { paymentId: 'payment-a', code: 'INVOICE_AMOUNT_INVALID' },
      ]);
      expect(result.issued.map((row) => row.paymentId)).toEqual([
        'payment-b',
        'payment-c',
      ]);
    });
  });

  describe('archive', () => {
    const SNAPSHOT: PaymentInvoiceSnapshot = {
      invoiceNumber: 'LF-CUS26-00007',
      issuedAt: PAID_AT.toISOString(),
      paidAt: PAID_AT.toISOString(),
      currency: 'EUR',
      amountTtcCents: 20_000,
      lines: [{ label: 'Batch cooking 4 repas', amountCents: 20_000 }],
      seller: { displayName: 'Chef Amina', city: null, sapDeclarationNumber: null },
      client: { name: 'Marie Dupont', email: 'marie@example.com' },
      booking: { reference: null, address: null, startsAt: PAID_AT.toISOString() },
    };

    beforeEach(() => {
      prisma.paymentInvoice.findUniqueOrThrow.mockResolvedValue({
        id: 'invoice-1',
        clientId: 'client-1',
        invoiceNumber: 'LF-CUS26-00007',
        snapshot: SNAPSHOT,
      });
    });

    it("stores the PDF under the client's folder and records where", async () => {
      await service.archive('invoice-1');

      expect(bucket.upload).toHaveBeenCalledWith(
        'clients/client-1/LF-CUS26-00007.pdf',
        expect.any(Buffer),
        { contentType: 'application/pdf', upsert: true },
      );
      expect(prisma.paymentInvoice.update).toHaveBeenCalledWith({
        where: { id: 'invoice-1' },
        data: {
          storagePath: 'clients/client-1/LF-CUS26-00007.pdf',
          archivedAt: expect.any(Date),
        },
      });
    });

    it('never throws: a storage failure must not undo a settled payment', async () => {
      bucket.upload.mockResolvedValue({ error: { message: 'Bucket not found' } });

      await expect(service.archive('invoice-1')).resolves.toBeUndefined();
      expect(prisma.paymentInvoice.update).not.toHaveBeenCalled();
    });

    it('draws and stores a missing PDF when it is downloaded', async () => {
      prisma.paymentInvoice.findFirst.mockResolvedValue({
        id: 'invoice-1',
        invoiceNumber: 'LF-CUS26-00007',
        storagePath: null,
      });

      const link = await service.downloadUrl('clerk_1', 'invoice-1');

      expect(bucket.upload).toHaveBeenCalled();
      expect(bucket.createSignedUrl).toHaveBeenCalledWith(
        'clients/client-1/LF-CUS26-00007.pdf',
        300,
        { download: 'facture-LF-CUS26-00007.pdf' },
      );
      expect(link.url).toBe('https://signed');
    });
  });

  describe('downloadUrl', () => {
    it("only looks among the caller's invoices, as client or as chef", async () => {
      prisma.paymentInvoice.findFirst.mockResolvedValue(null);

      await expect(service.downloadUrl('clerk_1', 'invoice-9')).rejects.toMatchObject({
        response: { code: 'INVOICE_NOT_FOUND' },
      });
      expect(prisma.paymentInvoice.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'invoice-9',
            OR: [{ clientId: 'client-1' }, { chefProfile: { userId: 'client-1' } }],
          },
        }),
      );
      expect(bucket.createSignedUrl).not.toHaveBeenCalled();
    });

    it('answers 503 when storage is not configured', async () => {
      supabase.configured = false;
      prisma.paymentInvoice.findFirst.mockResolvedValue({
        id: 'invoice-1',
        invoiceNumber: 'LF-CUS26-00007',
        storagePath: 'clients/client-1/LF-CUS26-00007.pdf',
      });

      await expect(service.downloadUrl('clerk_1', 'invoice-1')).rejects.toMatchObject({
        response: { code: 'DOCUMENT_STORAGE_UNAVAILABLE' },
      });
    });
  });
});
