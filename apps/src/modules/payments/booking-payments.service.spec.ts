import type { ConfigService } from '@nestjs/config';

import type { AuditService } from '../../common/audit/audit.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { UsersService } from '../users/users.service';
import { BookingPaymentsService } from './booking-payments.service';
import type { CommissionDebitsService } from './commission-debits.service';
import { settlePayment } from './payment-settlement';
import { UrssafGateway } from './urssaf.gateway';

jest.mock('./payment-settlement', () => ({
  ...jest.requireActual<object>('./payment-settlement'),
  settlePayment: jest.fn(),
}));

const PAYMENT_ID = 'p1';
const UPDATED_AT = new Date('2026-11-16T10:00:00Z');

function setup(mode: 'disabled' | 'simulated' | 'manual', metadata: object = {}) {
  const payment = {
    id: PAYMENT_ID,
    bookingId: 'b1',
    amountTtc: 18000,
    status: 'pending',
    metadata,
    updatedAt: UPDATED_AT,
  };
  const tx = {
    payment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    commission: {
      findUnique: jest.fn().mockResolvedValue({ id: 'c1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    payment: {
      findFirst: jest.fn().mockResolvedValue(payment),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const commissionDebits = { onCommissionDue: jest.fn() };
  const audit = { record: jest.fn() };
  const users = {
    ensurePersistedFromClerk: jest.fn().mockResolvedValue({ id: 'admin' }),
  };
  const gateway = new UrssafGateway({ get: () => mode } as unknown as ConfigService);
  const service = new BookingPaymentsService(
    prisma as unknown as PrismaService,
    users as unknown as UsersService,
    {} as ConfigService,
    gateway,
    commissionDebits as unknown as CommissionDebitsService,
    audit as unknown as AuditService,
  );
  return { service, prisma, commissionDebits, audit };
}

describe('BookingPaymentsService — manual URSSAF route', () => {
  beforeEach(() => jest.mocked(settlePayment).mockReset());

  describe('markTransmitted', () => {
    it('records the intermediary reference once', async () => {
      const { service, prisma, audit } = setup('manual', { debitedCents: 9000 });
      const result = await service.markTransmitted('clerk', PAYMENT_ID, ' UNI-42 ');

      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: PAYMENT_ID, status: 'pending', updatedAt: UPDATED_AT },
        data: {
          metadata: expect.objectContaining({
            debitedCents: 9000,
            externalReference: 'UNI-42',
            transmittedAt: expect.any(String),
          }),
        },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'urssaf.payment_transmitted' }),
      );
      expect(result).toEqual(
        expect.objectContaining({ paymentId: PAYMENT_ID, externalReference: 'UNI-42' }),
      );
    });

    it('answers 409 the second time', async () => {
      const { service } = setup('manual', { transmittedAt: '2026-11-16T09:00:00Z' });
      await expect(
        service.markTransmitted('clerk', PAYMENT_ID, 'UNI-42'),
      ).rejects.toMatchObject({
        response: { code: 'URSSAF_ALREADY_TRANSMITTED' },
      });
    });

    it('answers 409 when another admin got there first', async () => {
      const { service, prisma } = setup('manual');
      prisma.payment.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.markTransmitted('clerk', PAYMENT_ID, 'UNI-42'),
      ).rejects.toMatchObject({
        response: { code: 'URSSAF_ALREADY_TRANSMITTED' },
      });
    });

    it('is refused when the gateway is disabled', async () => {
      const { service } = setup('disabled');
      await expect(
        service.markTransmitted('clerk', PAYMENT_ID, 'UNI-42'),
      ).rejects.toMatchObject({
        response: { code: 'URSSAF_NOT_MANUAL_OR_SIMULATED' },
      });
    });
  });

  describe('recordAdminOutcome', () => {
    it('refuses `paid` in manual mode without a reference', async () => {
      const { service, commissionDebits } = setup('manual');
      await expect(
        service.recordAdminOutcome('clerk', PAYMENT_ID, 'paid', undefined, undefined),
      ).rejects.toMatchObject({ response: { code: 'URSSAF_REFERENCE_REQUIRED' } });
      expect(settlePayment).not.toHaveBeenCalled();
      expect(commissionDebits.onCommissionDue).not.toHaveBeenCalled();
    });

    it('settles a paid request in manual mode but leaves the commission to the admin', async () => {
      const { service, commissionDebits, audit } = setup('manual', {
        externalReference: 'UNI-42',
        transmittedAt: '2026-11-16T09:00:00Z',
      });
      const result = await service.recordAdminOutcome(
        'clerk',
        PAYMENT_ID,
        'paid',
        undefined,
        undefined,
      );

      expect(result.status).toBe('succeeded');
      expect(settlePayment).toHaveBeenCalled();
      expect(commissionDebits.onCommissionDue).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'urssaf.payment_recorded' }),
      );
    });

    it('takes the reference from the body when none was recorded', async () => {
      const { service, prisma } = setup('manual');
      await service.recordAdminOutcome('clerk', PAYMENT_ID, 'paid', undefined, 'UNI-43');
      expect(prisma.payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { metadata: expect.objectContaining({ externalReference: 'UNI-43' }) },
        }),
      );
      expect(settlePayment).toHaveBeenCalled();
    });

    it('accepts a refusal without a reference: Unipros may refuse before giving one', async () => {
      const { service } = setup('manual');
      const result = await service.recordAdminOutcome(
        'clerk',
        PAYMENT_ID,
        'refused',
        'IBAN invalide',
        undefined,
      );
      expect(result.status).toBe('failed');
    });

    it('keeps the automatic commission debit in simulated mode', async () => {
      const { service, commissionDebits, audit } = setup('simulated');
      await service.recordAdminOutcome('clerk', PAYMENT_ID, 'paid', undefined, undefined);
      expect(commissionDebits.onCommissionDue).toHaveBeenCalledWith('c1');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'urssaf.payment_simulated' }),
      );
    });
  });
});
