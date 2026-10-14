import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../prisma/prisma.service';
import { KycStorageService } from '../chef-onboarding/services/kyc-storage.service';
import { UsersService } from '../users/users.service';
import { CesuPaymentsService } from './cesu-payments.service';
import { CommissionDebitsService } from './commission-debits.service';
import type { DeclareCesuPaymentDto } from './dto/cesu.dto';

const CESU_READY_CHEF = {
  id: 'chef-1',
  isActive: true,
  isVerified: true,
  sapProfile: { acceptsCesu: true, crcesuNan: '1234567' },
};

const PENDING_BOOKING = {
  id: 'booking-1',
  reference: 'LF-2026-0001',
  status: 'pending',
  amountTtc: 12_500,
  priceCents: 12_500,
  currency: 'EUR',
  chefProfileId: 'chef-1',
  chefProfile: CESU_READY_CHEF,
};

const PROOF_ID = 'up_0123456789abcdef01234567';

const DECLARATION: DeclareCesuPaymentDto = {
  bookingId: 'booking-1',
  amountTtc: 6_000,
  medium: 'ecesu',
  issuer: 'pluxee',
  proofUploadId: PROOF_ID,
};

/** Row shape the DTO mapper reads back after a write. */
const declaredRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'payment-1',
  bookingId: 'booking-1',
  amountTtc: 6_000,
  currency: 'EUR',
  status: 'pending',
  method: 'cesu',
  createdAt: new Date('2026-09-05T10:00:00.000Z'),
  cesuSettlement: {
    medium: 'ecesu',
    issuer: 'pluxee',
    status: 'declared',
    clientProofRef: null,
    clientProofPath: 'cesu-proofs/booking-1/proof/up_old',
    clientProofUploadedAt: new Date('2026-09-05T09:58:00.000Z'),
    confirmedAt: null,
    rejectionReason: null,
    adminOverride: false,
  },
  booking: {
    id: 'booking-1',
    reference: 'LF-2026-0001',
    chefProfileId: 'chef-1',
    clientId: 'user-1',
    client: { fullName: 'Marie Client', email: 'marie@example.com' },
    chefProfile: { id: 'chef-1', displayName: 'Chef Marie D.', userId: 'user-9' },
  },
  commission: { id: 'commission-1' },
  ...overrides,
});

describe('CesuPaymentsService', () => {
  let prisma: {
    booking: { findFirst: jest.Mock };
    chefProfile: { findUnique: jest.Mock };
    payment: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      aggregate: jest.Mock;
      findFirst: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    commission: { findFirst: jest.Mock; findUnique: jest.Mock; updateMany: jest.Mock };
    commissionInvoice: { findFirst: jest.Mock };
    // No accepted offer and no saved rate: the environment default applies.
    quote: { findUnique: jest.Mock };
    platformSetting: { findUnique: jest.Mock };
    cesuSettlement: { update: jest.Mock; updateMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let tx: {
    payment: {
      update: jest.Mock;
      aggregate: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      findUnique: jest.Mock;
    };
    booking: { findUnique: jest.Mock; update: jest.Mock };
    commission: { updateMany: jest.Mock; findUnique: jest.Mock };
    cesuSettlement: { update: jest.Mock; updateMany: jest.Mock };
  };
  let commissionDebits: { maxAttempts: number; onCommissionDue: jest.Mock };
  let users: { ensurePersistedFromClerk: jest.Mock; requireOwnChefProfile: jest.Mock };
  let proofs: {
    buildPath: jest.Mock;
    statObject: jest.Mock;
    assertAcceptable: jest.Mock;
    createUploadUrl: jest.Mock;
    createDownloadUrl: jest.Mock;
    removeObjects: jest.Mock;
  };
  let service: CesuPaymentsService;

  const covered = (amount: number) => ({ _sum: { amountTtc: amount } });

  beforeEach(() => {
    tx = {
      payment: {
        update: jest.fn(),
        aggregate: jest.fn().mockResolvedValue(covered(6_000)),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue(declaredRow({ status: 'succeeded' })),
        findUnique: jest.fn(),
      },
      booking: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'booking-1',
          status: 'pending',
          amountTtc: 12_500,
          priceCents: 12_500,
        }),
        update: jest.fn(),
      },
      commission: {
        updateMany: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({ id: 'commission-1' }),
      },
      cesuSettlement: {
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma = {
      booking: { findFirst: jest.fn().mockResolvedValue(PENDING_BOOKING) },
      chefProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'chef-1' }) },
      payment: {
        create: jest.fn().mockResolvedValue(declaredRow()),
        findUnique: jest.fn().mockResolvedValue(declaredRow()),
        findMany: jest.fn().mockResolvedValue([declaredRow()]),
        aggregate: jest.fn().mockResolvedValue(covered(0)),
        findFirst: jest.fn().mockResolvedValue(declaredRow()),
        findUniqueOrThrow: jest.fn().mockResolvedValue(declaredRow()),
      },
      commission: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
      commissionInvoice: { findFirst: jest.fn().mockResolvedValue(null) },
      quote: { findUnique: jest.fn().mockResolvedValue(null) },
      platformSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      cesuSettlement: { update: jest.fn(), updateMany: jest.fn() },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    commissionDebits = { maxAttempts: 3, onCommissionDue: jest.fn() };
    users = {
      ensurePersistedFromClerk: jest.fn().mockResolvedValue({ id: 'user-1' }),
      // Mirrors the real helper by reading the same `chefProfile.findUnique` the tests
      // already drive, so a per-test override of that mock still selects the chef.
      requireOwnChefProfile: jest.fn(async () => ({
        id: (await prisma.chefProfile.findUnique({}))?.id,
        userId: 'user-1',
      })),
    };

    const get = jest.fn((key: string, fallback?: unknown) =>
      key === 'payments.commissionRateBps'
        ? 1500
        : key === 'payments.commissionVatRateBps'
          ? 2000
          : fallback,
    );
    const config = { get, getOrThrow: get };

    proofs = {
      buildPath: jest.fn(
        (prefix: string, type: string, id: string) => `${prefix}/${type}/${id}`,
      ),
      statObject: jest
        .fn()
        .mockResolvedValue({ sizeBytes: 120_000, mimeType: 'application/pdf' }),
      assertAcceptable: jest.fn(),
      createUploadUrl: jest.fn().mockResolvedValue({
        uploadId: PROOF_ID,
        storagePath: `cesu-proofs/booking-1/proof/${PROOF_ID}`,
        method: 'PUT',
        url: 'https://storage.example/upload',
        headers: { 'Content-Type': 'application/pdf' },
        expiresAt: new Date('2026-09-05T12:00:00.000Z'),
      }),
      createDownloadUrl: jest
        .fn()
        .mockResolvedValue({ url: 'https://storage.example/read' }),
      removeObjects: jest.fn(),
    };

    service = new CesuPaymentsService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
      users as unknown as UsersService,
      commissionDebits as unknown as CommissionDebitsService,
      proofs as unknown as KycStorageService,
    );
  });

  describe('declare', () => {
    it('opens a pending payment with a direct-debit commission and a declared settlement', async () => {
      const result = await service.declare('clerk_1', DECLARATION);

      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            bookingId: 'booking-1',
            method: 'cesu',
            status: 'pending',
            amountTtc: 6_000,
            commission: {
              create: expect.objectContaining({
                // Stripe cannot split a payment it never sees.
                collectionMethod: 'sepa_direct_debit',
                status: 'pending',
                basisAmountCents: 6_000,
                amountHtCents: 900,
                amountVatCents: 180,
                amountTtcCents: 1080,
              }),
            },
            cesuSettlement: {
              create: expect.objectContaining({
                medium: 'ecesu',
                issuer: 'pluxee',
                status: 'declared',
              }),
            },
          }),
        }),
      );
      expect(result.settlementStatus).toBe('declared');
    });

    it('drops the issuer on a paper declaration', async () => {
      await service.declare('clerk_1', {
        ...DECLARATION,
        medium: 'cesu_paper',
        issuer: 'edenred',
      });

      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cesuSettlement: {
              create: expect.objectContaining({ medium: 'cesu_paper', issuer: null }),
            },
          }),
        }),
      );
    });

    it('refuses to declare more than is left to pay', async () => {
      // CRCESU rules forbid any surcharge, so over-declaring must be impossible: there is
      // no fee field on this path and nothing may exceed the amount due.
      prisma.payment.aggregate.mockResolvedValue(covered(10_000));

      await expect(
        service.declare('clerk_1', { ...DECLARATION, amountTtc: 6_000 }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('accepts a declaration for exactly what is left', async () => {
      prisma.payment.aggregate.mockResolvedValue(covered(6_500));

      await service.declare('clerk_1', { ...DECLARATION, amountTtc: 6_000 });

      expect(prisma.payment.create).toHaveBeenCalled();
    });

    it('refuses a booking that is already fully covered', async () => {
      prisma.payment.aggregate.mockResolvedValue(covered(12_500));

      await expect(service.declare('clerk_1', DECLARATION)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('refuses a chef who has not opted in to CESU', async () => {
      prisma.booking.findFirst.mockResolvedValue({
        ...PENDING_BOOKING,
        chefProfile: {
          ...CESU_READY_CHEF,
          sapProfile: { acceptsCesu: false, crcesuNan: '1234567' },
        },
      });

      await expect(service.declare('clerk_1', DECLARATION)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('refuses a chef who opted in but has no NAN', async () => {
      // Without the number the client cannot add them on the issuer portal at all.
      prisma.booking.findFirst.mockResolvedValue({
        ...PENDING_BOOKING,
        chefProfile: {
          ...CESU_READY_CHEF,
          sapProfile: { acceptsCesu: true, crcesuNan: null },
        },
      });

      await expect(service.declare('clerk_1', DECLARATION)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it.each([
      ['unverified', { isActive: true, isVerified: false }],
      ['deactivated', { isActive: false, isVerified: true }],
    ])('refuses a chef who is %s', async (_label, flags) => {
      prisma.booking.findFirst.mockResolvedValue({
        ...PENDING_BOOKING,
        chefProfile: { ...CESU_READY_CHEF, ...flags },
      });

      await expect(service.declare('clerk_1', DECLARATION)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('refuses a chef whose commission invoice ran out of debit attempts', async () => {
      prisma.commissionInvoice.findFirst.mockResolvedValue({
        invoiceNumber: 'LF-COM-2026-0007',
      });

      await expect(service.declare('clerk_1', DECLARATION)).rejects.toThrow(
        /LF-COM-2026-0007/,
      );
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('turns the partial unique index violation into a readable 409', async () => {
      prisma.payment.create.mockRejectedValue(
        Object.assign(new Error('dup'), {
          code: 'P2002',
        }),
      );

      await expect(service.declare('clerk_1', DECLARATION)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('404s on a booking owned by someone else', async () => {
      prisma.booking.findFirst.mockResolvedValue(null);

      await expect(service.declare('clerk_1', DECLARATION)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('keeps the e-CESU proof, under the booking, on the settlement', async () => {
      await service.declare('clerk_1', DECLARATION);

      expect(proofs.statObject).toHaveBeenCalledWith(
        `cesu-proofs/booking-1/proof/${PROOF_ID}`,
      );
      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cesuSettlement: {
              create: expect.objectContaining({
                clientProofPath: `cesu-proofs/booking-1/proof/${PROOF_ID}`,
                clientProofUploadedAt: expect.any(Date),
              }),
            },
          }),
        }),
      );
    });

    it('refuses a proof that never arrived', async () => {
      proofs.statObject.mockRejectedValue(new ConflictException('no file'));

      await expect(service.declare('clerk_1', DECLARATION)).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('declares paper CESU without any proof', async () => {
      await service.declare('clerk_1', {
        ...DECLARATION,
        medium: 'cesu_paper',
        proofUploadId: undefined,
      });

      expect(proofs.statObject).not.toHaveBeenCalled();
      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cesuSettlement: {
              create: expect.objectContaining({ clientProofPath: null }),
            },
          }),
        }),
      );
    });
  });

  describe('e-CESU proof', () => {
    it('hands out an upload link under the client’s own booking', async () => {
      const upload = await service.proofUploadUrl('clerk_1', 'booking-1', {
        contentType: 'application/pdf',
        sizeBytes: 120_000,
      });

      expect(proofs.createUploadUrl).toHaveBeenCalledWith(
        'cesu-proofs/booking-1',
        'proof',
        'application/pdf',
        120_000,
      );
      expect(upload).not.toHaveProperty('storagePath');
    });

    it('404s the upload link on someone else’s booking', async () => {
      prisma.booking.findFirst.mockResolvedValue(null);

      await expect(
        service.proofUploadUrl('clerk_1', 'booking-1', {
          contentType: 'application/pdf',
          sizeBytes: 1,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('replaces a wrong file while the chef has not answered', async () => {
      prisma.cesuSettlement.updateMany.mockResolvedValue({ count: 1 });

      await service.replaceProof('clerk_1', 'payment-1', PROOF_ID);

      expect(prisma.cesuSettlement.updateMany).toHaveBeenCalledWith({
        where: { paymentId: 'payment-1', status: 'declared' },
        data: expect.objectContaining({
          clientProofPath: `cesu-proofs/booking-1/proof/${PROOF_ID}`,
        }),
      });
      expect(proofs.removeObjects).toHaveBeenCalledWith([
        'cesu-proofs/booking-1/proof/up_old',
      ]);
    });

    it('keeps the proof as it is once the chef answered', async () => {
      prisma.cesuSettlement.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.replaceProof('clerk_1', 'payment-1', PROOF_ID),
      ).rejects.toThrow(ConflictException);
      expect(proofs.removeObjects).not.toHaveBeenCalled();
    });

    it('gives an admin a short-lived link for a dispute', async () => {
      const link = await service.adminProofUrl('payment-1');

      expect(proofs.createDownloadUrl).toHaveBeenCalledWith(
        'cesu-proofs/booking-1/proof/up_old',
      );
      expect(link).toEqual({ url: 'https://storage.example/read' });
    });
  });

  describe('confirm', () => {
    it('settles the payment and traces who confirmed it', async () => {
      await service.confirm('clerk_1', 'payment-1');

      expect(tx.payment.update).toHaveBeenCalledWith({
        where: { id: 'payment-1' },
        data: expect.objectContaining({
          status: 'succeeded',
          taxCreditEligibleAmount: 6_000,
        }),
      });
      expect(tx.cesuSettlement.updateMany).toHaveBeenCalledWith({
        where: { paymentId: 'payment-1', status: 'declared' },
        data: expect.objectContaining({
          status: 'confirmed',
          confirmedByUserId: 'user-1',
          adminOverride: false,
        }),
      });
    });

    it('leaves the booking pending while the payments do not cover it', async () => {
      await service.confirm('clerk_1', 'payment-1');

      expect(tx.booking.update).not.toHaveBeenCalled();
    });

    it('confirms the booking once the payments add up', async () => {
      tx.payment.aggregate.mockResolvedValue(covered(12_500));

      await service.confirm('clerk_1', 'payment-1');

      expect(tx.booking.update).toHaveBeenCalledWith({
        where: { id: 'booking-1' },
        data: { status: 'confirmed' },
      });
    });

    it('makes the commission due only after the transaction commits', async () => {
      await service.confirm('clerk_1', 'payment-1');

      expect(commissionDebits.onCommissionDue).toHaveBeenCalledWith('commission-1');
      const commitOrder = prisma.$transaction.mock.invocationCallOrder[0];
      const debitOrder = commissionDebits.onCommissionDue.mock.invocationCallOrder[0];
      expect(debitOrder).toBeGreaterThan(commitOrder);
    });

    it('refuses to confirm another chef payment', async () => {
      prisma.chefProfile.findUnique.mockResolvedValue({ id: 'chef-2' });

      await expect(service.confirm('clerk_1', 'payment-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses a second confirmation that races the first', async () => {
      // The settlement is claimed conditionally on `declared`, so two simultaneous
      // confirmations cannot both write a tax-credit line.
      tx.cesuSettlement.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.confirm('clerk_1', 'payment-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(tx.payment.update).not.toHaveBeenCalled();
    });

    it('refuses to confirm an already-settled declaration', async () => {
      prisma.payment.findUnique.mockResolvedValue(
        declaredRow({
          cesuSettlement: { ...declaredRow().cesuSettlement, status: 'confirmed' },
        }),
      );

      await expect(service.confirm('clerk_1', 'payment-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('reject', () => {
    it('fails the payment and its commission, leaving the booking payable again', async () => {
      tx.payment.findUniqueOrThrow.mockResolvedValue(
        declaredRow({
          status: 'failed',
          cesuSettlement: { ...declaredRow().cesuSettlement, status: 'rejected' },
        }),
      );

      await service.reject('clerk_1', 'payment-1', 'Aucun règlement reçu.');

      expect(tx.payment.update).toHaveBeenCalledWith({
        where: { id: 'payment-1' },
        data: { status: 'failed', failureReason: 'Aucun règlement reçu.' },
      });
      expect(tx.commission.updateMany).toHaveBeenCalledWith({
        where: { paymentId: 'payment-1' },
        data: { status: 'failed' },
      });
      expect(tx.booking.update).not.toHaveBeenCalled();
      expect(commissionDebits.onCommissionDue).not.toHaveBeenCalled();
    });
  });

  describe('forceSettle', () => {
    it('records the admin and the evidence they acted on', async () => {
      await service.forceSettle('clerk_admin', 'payment-1', 'ZD-18422');

      expect(tx.cesuSettlement.updateMany).toHaveBeenCalledWith({
        where: { paymentId: 'payment-1', status: 'declared' },
        data: expect.objectContaining({
          status: 'confirmed',
          adminOverride: true,
          adminProofRef: 'ZD-18422',
          confirmedByUserId: 'user-1',
        }),
      });
    });
  });

  describe('getChefCesuInfo', () => {
    it('publishes the NAN so a client can pay before any booking exists', async () => {
      prisma.chefProfile.findUnique.mockResolvedValue({
        id: 'chef-1',
        displayName: 'Chef Marie D.',
        isActive: true,
        isVerified: true,
        sapProfile: {
          acceptsCesu: true,
          crcesuNan: '1234567',
          crcesuAffiliationStatus: 'active',
        },
      });

      const info = await service.getChefCesuInfo('chef-1');

      expect(info).toMatchObject({ acceptsCesu: true, crcesuNan: '1234567' });
      expect(info.supportedIssuers).toContain('domiserve');
    });

    it('withholds the NAN from a chef who has not opted in', async () => {
      prisma.chefProfile.findUnique.mockResolvedValue({
        id: 'chef-1',
        displayName: 'Chef Marie D.',
        isActive: true,
        isVerified: true,
        sapProfile: {
          acceptsCesu: false,
          crcesuNan: '1234567',
          crcesuAffiliationStatus: 'pending',
        },
      });

      const info = await service.getChefCesuInfo('chef-1');

      expect(info).toMatchObject({ acceptsCesu: false, crcesuNan: null });
    });

    it('404s on a chef who is not open for bookings', async () => {
      prisma.chefProfile.findUnique.mockResolvedValue({
        id: 'chef-1',
        displayName: 'Chef Marie D.',
        isActive: false,
        isVerified: true,
        sapProfile: null,
      });

      await expect(service.getChefCesuInfo('chef-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('getBookingPaymentStatus', () => {
    it('reports what is left and the NAN needed to pay it in CESU', async () => {
      prisma.payment.aggregate.mockResolvedValue(covered(6_000));

      const status = await service.getBookingPaymentStatus('clerk_1', 'booking-1');

      expect(status).toMatchObject({
        amountTtcCents: 12_500,
        coveredAmountCents: 6_000,
        remainingAmountCents: 6_500,
        fullyCovered: false,
        cesuAvailable: true,
        crcesuNan: '1234567',
      });
    });

    it('counts only settled payments towards coverage', async () => {
      await service.getBookingPaymentStatus('clerk_1', 'booking-1');

      expect(prisma.payment.aggregate).toHaveBeenCalledWith({
        where: { bookingId: 'booking-1', status: 'succeeded' },
        _sum: { amountTtc: true },
      });
    });
  });
});
