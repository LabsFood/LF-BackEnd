import { ConflictException, Logger } from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AvailabilityService } from '../calendar/availability.service';
import { UsersService } from '../users/users.service';
import { BookingReschedulesService } from './booking-reschedules.service';
import { BookingsMailer } from './bookings.mailer';

const HOUR = 3_600_000;
// One instant for every fixture, so times read twice are equal to the millisecond.
const NOW = Date.now();
const hoursAhead = (h: number) => new Date(NOW + h * HOUR);

const booking = (over: Record<string, unknown> = {}) => {
  const startsAt = hoursAhead(7 * 24);
  return {
    id: 'b1',
    reference: 'LF-2030-0001',
    status: 'confirmed',
    chefProfileId: 'chef-1',
    startsAt,
    endsAt: new Date(startsAt.getTime() + 3 * HOUR),
    client: { email: 'sophie@example.com', fullName: 'Sophie Marchand' },
    chefProfile: {
      displayName: 'Chez Marie',
      user: { email: 'marie@example.com', fullName: 'Marie Durand' },
    },
    ...over,
  };
};

const proposal = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  proposedByRole: 'chef',
  fromStartsAt: booking().startsAt,
  toStartsAt: hoursAhead(8 * 24),
  status: 'pending',
  expiresAt: hoursAhead(40),
  decidedAt: null,
  ...over,
});

const p2 = (code: string) =>
  new Prisma.PrismaClientKnownRequestError(code, { code, clientVersion: 'test' });

describe('BookingReschedulesService', () => {
  let prisma: Record<string, Record<string, jest.Mock>> & { $transaction: jest.Mock };
  let availability: { assertBookable: jest.Mock };
  let mailer: { rescheduleProposed: jest.Mock; rescheduleAnswered: jest.Mock };
  let service: BookingReschedulesService;
  let current: ReturnType<typeof booking>;

  beforeEach(() => {
    current = booking();
    prisma = {
      booking: {
        findFirst: jest.fn(async () => current),
        update: jest.fn().mockResolvedValue({}),
      },
      bookingReschedule: {
        create: jest.fn(async ({ data }) => ({
          id: 'r1',
          status: 'pending',
          decidedAt: null,
          ...data,
        })),
        findFirst: jest.fn().mockResolvedValue(proposal()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(),
    } as never;
    prisma.$transaction.mockImplementation((work: (tx: unknown) => unknown) =>
      work(prisma),
    );
    availability = { assertBookable: jest.fn().mockResolvedValue(undefined) };
    mailer = {
      rescheduleProposed: jest.fn().mockResolvedValue(undefined),
      rescheduleAnswered: jest.fn().mockResolvedValue(undefined),
    };
    const users = {
      ensurePersistedFromClerk: jest.fn().mockResolvedValue({ id: 'client-1' }),
      chefIdentity: jest
        .fn()
        .mockResolvedValue({ userId: 'chef-user', chefProfileId: 'chef-1' }),
    };
    service = new BookingReschedulesService(
      prisma as unknown as PrismaService,
      users as unknown as UsersService,
      availability as unknown as AvailabilityService,
      mailer as unknown as BookingsMailer,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('propose', () => {
    it('lets either side propose, keeps the duration, and asks the other side', async () => {
      const to = hoursAhead(8 * 24);

      const view = await service.propose('client', 'clerk_1', 'b1', to);

      expect(prisma.booking.findFirst.mock.calls[0][0].where).toEqual({
        id: 'b1',
        clientId: 'client-1',
      });
      expect(availability.assertBookable).toHaveBeenCalledWith(
        'chef-1',
        to,
        new Date(to.getTime() + 3 * HOUR),
        'b1',
      );
      expect(prisma.bookingReschedule.create.mock.calls[0][0].data).toMatchObject({
        bookingId: 'b1',
        proposedByRole: 'client',
        proposedByUserId: 'client-1',
        fromStartsAt: current.startsAt,
        toStartsAt: to,
      });
      expect(view).toMatchObject({ proposedBy: 'client', to, status: 'pending' });
      expect(mailer.rescheduleProposed).toHaveBeenCalledWith(
        expect.objectContaining({
          proposerName: 'Sophie M.',
          recipient: expect.objectContaining({
            email: 'marie@example.com',
            side: 'chef',
          }),
        }),
      );
    });

    it('scopes a batch cooker to their own prestations', async () => {
      await service.propose('chef', 'clerk_2', 'b1', hoursAhead(8 * 24));

      expect(prisma.booking.findFirst.mock.calls[0][0].where).toEqual({
        id: 'b1',
        chefProfileId: 'chef-1',
      });
    });

    it('gives 48 h to answer, cut short to 48 h before the start', async () => {
      current = booking({
        startsAt: hoursAhead(60),
        endsAt: hoursAhead(63),
      });

      const view = await service.propose('chef', 'clerk_2', 'b1', hoursAhead(100));

      expect(view.expiresAt.getTime()).toBeCloseTo(hoursAhead(12).getTime(), -4);
    });

    it('freezes the last 48 h, and anything not confirmed', async () => {
      current = booking({ startsAt: hoursAhead(47), endsAt: hoursAhead(50) });
      await expect(
        service.propose('client', 'clerk_1', 'b1', hoursAhead(100)),
      ).rejects.toMatchObject({ response: { code: 'BOOKING_NOT_RESCHEDULABLE' } });

      current = booking();
      await expect(
        service.propose('client', 'clerk_1', 'b1', hoursAhead(47)),
      ).rejects.toMatchObject({ response: { code: 'BOOKING_NOT_RESCHEDULABLE' } });

      current = booking({ status: 'pending' });
      await expect(
        service.propose('client', 'clerk_1', 'b1', hoursAhead(100)),
      ).rejects.toMatchObject({ response: { code: 'BOOKING_NOT_RESCHEDULABLE' } });
      expect(prisma.bookingReschedule.create).not.toHaveBeenCalled();
    });

    it('refuses a time the batch cooker is not free', async () => {
      availability.assertBookable.mockRejectedValue(
        new ConflictException({ code: 'SLOT_UNAVAILABLE', message: 'busy' }),
      );

      await expect(
        service.propose('client', 'clerk_1', 'b1', hoursAhead(8 * 24)),
      ).rejects.toMatchObject({ response: { code: 'SLOT_UNAVAILABLE' } });
    });

    it('keeps one open proposal per booking', async () => {
      prisma.bookingReschedule.create.mockRejectedValue(p2('P2002'));

      await expect(
        service.propose('client', 'clerk_1', 'b1', hoursAhead(8 * 24)),
      ).rejects.toMatchObject({ response: { code: 'RESCHEDULE_PENDING' } });
    });

    it('lets a lapsed proposal go before making a new one', async () => {
      await service.propose('client', 'clerk_1', 'b1', hoursAhead(8 * 24));

      expect(prisma.bookingReschedule.updateMany.mock.calls[0][0]).toMatchObject({
        where: { bookingId: 'b1', status: 'pending' },
        data: { status: 'expired' },
      });
    });

    it('still proposes when the email fails, and logs no name or email', async () => {
      const calls: unknown[][] = [];
      for (const level of ['log', 'error'] as const) {
        jest
          .spyOn(Logger.prototype, level)
          .mockImplementation((...args: unknown[]) => void calls.push(args));
      }
      mailer.rescheduleProposed.mockRejectedValue(new Error('brevo down'));

      await expect(
        service.propose('client', 'clerk_1', 'b1', hoursAhead(8 * 24)),
      ).resolves.toMatchObject({ status: 'pending' });
      const written = JSON.stringify(calls);
      for (const value of [
        'Sophie',
        'Marchand',
        'marie@example.com',
        'sophie@example.com',
      ]) {
        expect(written).not.toContain(value);
      }
      expect(written).toContain('reschedule.mail_failed');
    });
  });

  describe('decide', () => {
    it('moves the prestation when the other side confirms: the four time fields only', async () => {
      const to = proposal().toStartsAt;

      await service.decide('client', 'clerk_1', 'b1', 'accepted');

      expect(availability.assertBookable).toHaveBeenCalledWith(
        'chef-1',
        to,
        new Date(to.getTime() + 3 * HOUR),
        'b1',
      );
      const update = prisma.booking.update.mock.calls[0][0];
      expect(update.where).toEqual({
        id: 'b1',
        status: 'confirmed',
        startsAt: current.startsAt,
      });
      expect(Object.keys(update.data).sort()).toEqual(
        ['bookingDate', 'endsAt', 'startsAt', 'timeSlot'].sort(),
      );
      expect(update.data.startsAt).toEqual(to);
      expect(mailer.rescheduleAnswered).toHaveBeenCalledWith(
        expect.objectContaining({
          accepted: true,
          answererName: 'Sophie M.',
          recipient: expect.objectContaining({ side: 'chef' }),
        }),
      );
    });

    it('never lets the proposer confirm their own', async () => {
      await expect(
        service.decide('chef', 'clerk_2', 'b1', 'accepted'),
      ).rejects.toMatchObject({ response: { code: 'RESCHEDULE_OWN_PROPOSAL' } });
    });

    it('lets only the proposer withdraw, without an email', async () => {
      await expect(
        service.decide('client', 'clerk_1', 'b1', 'withdrawn'),
      ).rejects.toMatchObject({ response: { code: 'RESCHEDULE_NOT_YOURS' } });

      await service.decide('chef', 'clerk_2', 'b1', 'withdrawn');
      expect(prisma.bookingReschedule.updateMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'withdrawn' }),
        }),
      );
      expect(mailer.rescheduleAnswered).not.toHaveBeenCalled();
    });

    it('refuses an answer after expiresAt, even before the job ran', async () => {
      prisma.bookingReschedule.findFirst.mockResolvedValue(
        proposal({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(
        service.decide('client', 'clerk_1', 'b1', 'accepted'),
      ).rejects.toMatchObject({ response: { code: 'RESCHEDULE_EXPIRED' } });
      expect(prisma.booking.update).not.toHaveBeenCalled();
    });

    it('fails with CHANGED_MEANWHILE when the booking moved or changed status meanwhile', async () => {
      prisma.booking.update.mockRejectedValue(p2('P2025'));

      await expect(
        service.decide('client', 'clerk_1', 'b1', 'accepted'),
      ).rejects.toMatchObject({ response: { code: 'CHANGED_MEANWHILE' } });
    });

    it('fails with CHANGED_MEANWHILE when two answers race', async () => {
      prisma.bookingReschedule.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.decide('client', 'clerk_1', 'b1', 'declined'),
      ).rejects.toMatchObject({ response: { code: 'CHANGED_MEANWHILE' } });
    });

    it('404s when no new time waits', async () => {
      prisma.bookingReschedule.findFirst.mockResolvedValue(null);

      await expect(
        service.decide('client', 'clerk_1', 'b1', 'declined'),
      ).rejects.toMatchObject({ response: { code: 'RESCHEDULE_NOT_FOUND' } });
    });
  });

  it('lets unanswered proposals lapse every hour', async () => {
    const now = new Date('2030-03-10T12:00:00Z');
    prisma.bookingReschedule.updateMany.mockResolvedValue({ count: 3 });

    await expect(service.expireDue(now)).resolves.toBe(3);
    expect(prisma.bookingReschedule.updateMany).toHaveBeenCalledWith({
      where: { status: 'pending', expiresAt: { lte: now } },
      data: { status: 'expired', decidedAt: now },
    });
  });
});
