import { AuditService } from '../../common/audit/audit.service';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import { BookingWithdrawalsService } from './booking-withdrawals.service';
import { BookingsMailer } from './bookings.mailer';
import { BookingsService } from './bookings.service';

const NOW = new Date('2026-12-01T09:00:00.000Z');
const CONCLUDED = new Date('2026-11-28T10:00:00.000Z');

const booking = (over: Record<string, unknown> = {}) => ({
  id: 'booking-1',
  reference: 'LF-2026-0042',
  status: 'confirmed',
  concludedAt: CONCLUDED,
  withdrawnAt: null,
  earlyExecutionRequestedAt: null,
  amountTtc: 12_000,
  priceCents: 12_000,
  client: { email: 'sophie@example.com', fullName: 'Sophie Martin' },
  chefProfile: { displayName: 'Chef Marie', userId: 'chef-user' },
  payments: [{ method: 'cb' }],
  ...over,
});

describe('BookingWithdrawalsService', () => {
  let prisma: {
    booking: { findFirst: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
    payment: { aggregate: jest.Mock };
  };
  let mailer: { withdrawalAck: jest.Mock; withdrawalAdmin: jest.Mock };
  let audit: { record: jest.Mock };
  let notifications: { notify: jest.Mock };
  let bookings: { detailFor: jest.Mock };
  let service: BookingWithdrawalsService;

  beforeEach(() => {
    jest.useFakeTimers({
      now: NOW,
      doNotFake: [
        'nextTick',
        'setImmediate',
        'setTimeout',
        'setInterval',
        'queueMicrotask',
      ],
    });
    prisma = {
      booking: {
        findFirst: jest.fn().mockResolvedValue(booking()),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      payment: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amountTtc: 12_000 } }),
      },
    };
    mailer = {
      withdrawalAck: jest.fn().mockResolvedValue({ sent: true }),
      withdrawalAdmin: jest.fn().mockResolvedValue({ sent: true }),
    };
    audit = { record: jest.fn() };
    notifications = { notify: jest.fn().mockResolvedValue({}) };
    bookings = { detailFor: jest.fn().mockResolvedValue({ id: 'booking-1' }) };
    service = new BookingWithdrawalsService(
      prisma as unknown as PrismaService,
      {
        ensurePersistedFromClerk: jest.fn().mockResolvedValue({ id: 'client-1' }),
      } as unknown as UsersService,
      bookings as unknown as BookingsService,
      mailer as unknown as BookingsMailer,
      audit as unknown as AuditService,
      notifications as unknown as NotificationsService,
    );
  });
  afterEach(() => jest.useRealTimers());

  it('cancels the booking, keeping what remains due, only if nobody withdrew meanwhile', async () => {
    await service.withdraw('clerk_1', 'booking-1');

    expect(prisma.booking.findFirst.mock.calls[0][0].where).toEqual({
      id: 'booking-1',
      clientId: 'client-1',
    });
    expect(prisma.booking.update).toHaveBeenCalledWith({
      where: { id: 'booking-1', status: 'confirmed', withdrawnAt: null },
      data: { status: 'cancelled', withdrawnAt: NOW, withdrawalDueCents: 0 },
    });
  });

  it('acknowledges at once, with the declaration, its date and the refund', async () => {
    await service.withdraw('clerk_1', 'booking-1');

    expect(mailer.withdrawalAck).toHaveBeenCalledWith(
      expect.objectContaining({
        reference: 'LF-2026-0042',
        chefName: 'Chef Marie',
        submittedAt: NOW,
        declaration: expect.stringContaining('ma rétractation du contrat'),
        dueCents: 0,
        refundCents: 12_000,
      }),
    );
    // Claimed before sending: a second instance sends nothing.
    expect(prisma.booking.updateMany).toHaveBeenCalledWith({
      where: { id: 'booking-1', withdrawalAckSentAt: null },
      data: { withdrawalAckSentAt: NOW },
    });
  });

  it('gives the acknowledgement back to the retry job when the email did not go', async () => {
    mailer.withdrawalAck.mockResolvedValue({ sent: false });

    await service.withdraw('clerk_1', 'booking-1');

    expect(prisma.booking.update).toHaveBeenLastCalledWith({
      where: { id: 'booking-1' },
      data: { withdrawalAckSentAt: null },
    });
  });

  it('tells the team what to refund by hand, by when, and the batch cooker in-app', async () => {
    await service.withdraw('clerk_1', 'booking-1');

    expect(mailer.withdrawalAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        paidCents: 12_000,
        dueCents: 0,
        refundCents: 12_000,
        methods: ['cb'],
        deadline: new Date('2026-12-15T09:00:00.000Z'),
      }),
    );
    expect(notifications.notify).toHaveBeenCalledWith('chef-user', 'booking.withdrawn', {
      type: 'booking',
      id: 'booking-1',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'client',
        action: 'booking.withdrawn',
        subjectId: 'booking-1',
        metadata: expect.objectContaining({
          channel: 'online',
          paidCents: 12_000,
          dueCents: 0,
          refundCents: 12_000,
        }),
      }),
    );
  });

  it('says why a withdrawal is refused, writing nothing', async () => {
    prisma.booking.findFirst.mockResolvedValue(
      booking({ concludedAt: new Date('2026-11-01T10:00:00.000Z') }),
    );

    await expect(service.withdraw('clerk_1', 'booking-1')).rejects.toMatchObject({
      status: 409,
      response: { code: 'WITHDRAWAL_PERIOD_OVER' },
    });
    expect(prisma.booking.update).not.toHaveBeenCalled();
    expect(mailer.withdrawalAck).not.toHaveBeenCalled();
  });

  it('reports a withdrawal sent meanwhile instead of sending a second', async () => {
    prisma.booking.update.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('gone', {
        code: 'P2025',
        clientVersion: 'test',
      }),
    );

    await expect(service.withdraw('clerk_1', 'booking-1')).rejects.toMatchObject({
      response: { code: 'CHANGED_MEANWHILE' },
    });
    expect(mailer.withdrawalAck).not.toHaveBeenCalled();
  });

  it('never lets a failed heads-up undo the withdrawal', async () => {
    mailer.withdrawalAdmin.mockRejectedValue(new Error('Brevo down'));
    notifications.notify.mockRejectedValue(new Error('DB hiccup'));

    await expect(service.withdraw('clerk_1', 'booking-1')).resolves.toEqual({
      id: 'booking-1',
    });
  });
});
