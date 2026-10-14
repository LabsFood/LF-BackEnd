import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { AvailabilityService } from './availability.service';

// Thursday 12 March 2030, 9:00–12:00 in Paris (UTC+1).
const START = new Date('2030-03-12T08:00:00Z');
const END = new Date('2030-03-12T11:00:00Z');
const MORNINGS = [{ weekday: 1, startMinute: 480, endMinute: 780 }]; // Tuesdays 8:00–13:00

describe('AvailabilityService', () => {
  let prisma: Record<string, Record<string, jest.Mock>> & { $transaction: jest.Mock };
  let service: AvailabilityService;

  beforeEach(() => {
    prisma = {
      chefWorkingHour: {
        findMany: jest.fn().mockResolvedValue(MORNINGS),
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      chefAvailabilityException: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      booking: { findMany: jest.fn().mockResolvedValue([]) },
      serviceOffer: { findFirst: jest.fn() },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    } as never;
    const users = {
      chefIdentity: jest
        .fn()
        .mockResolvedValue({ userId: 'u1', chefProfileId: 'chef-1' }),
    };
    service = new AvailabilityService(
      prisma as unknown as PrismaService,
      users as unknown as UsersService,
    );
  });

  describe('assertBookable', () => {
    it('accepts a time inside working hours with nothing in the way', async () => {
      await expect(service.assertBookable('chef-1', START, END)).resolves.toBeUndefined();
    });

    it('refuses a time outside working hours', async () => {
      const late = new Date('2030-03-12T11:00:00Z');
      await expect(
        service.assertBookable('chef-1', late, new Date('2030-03-12T14:00:00Z')),
      ).rejects.toMatchObject({ response: { code: 'SLOT_UNAVAILABLE' } });
    });

    it('refuses a time another booking holds', async () => {
      prisma.booking.findMany.mockResolvedValueOnce([
        {
          startsAt: new Date('2030-03-12T10:00:00Z'),
          endsAt: new Date('2030-03-12T11:30:00Z'),
        },
      ]);
      await expect(service.assertBookable('chef-1', START, END)).rejects.toMatchObject({
        response: { code: 'SLOT_UNAVAILABLE' },
      });
    });

    it('leaves the booking being moved out of what is busy', async () => {
      await service.assertBookable('chef-1', START, END, 'b1');

      expect(prisma.booking.findMany.mock.calls[0][0].where).toMatchObject({
        chefProfileId: 'chef-1',
        id: { not: 'b1' },
        status: { in: ['pending', 'confirmed', 'shopping', 'cooking', 'delivered'] },
      });
    });

    it('without working hours, only checks what is already taken', async () => {
      prisma.chefWorkingHour.findMany.mockResolvedValue([]);

      await expect(
        service.assertBookable(
          'chef-1',
          new Date('2030-03-12T20:00:00Z'),
          new Date('2030-03-12T22:00:00Z'),
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe('replaceSchedule', () => {
    it('refuses two ranges of one day that overlap', async () => {
      await expect(
        service.replaceSchedule('clerk_1', {
          weekly: [
            { weekday: 0, startMinute: 540, endMinute: 780 },
            { weekday: 0, startMinute: 720, endMinute: 900 },
          ],
          exceptions: [],
        }),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_FAILED' } });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('replaces the whole schedule; a closed day keeps no hours', async () => {
      await service.replaceSchedule('clerk_1', {
        weekly: MORNINGS,
        exceptions: [{ date: '2030-12-24', kind: 'closed', startMinute: 600 }],
      });

      expect(prisma.chefWorkingHour.deleteMany).toHaveBeenCalledWith({
        where: { chefProfileId: 'chef-1' },
      });
      expect(prisma.chefAvailabilityException.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            date: new Date('2030-12-24T00:00:00.000Z'),
            kind: 'closed',
            startMinute: null,
            endMinute: null,
          }),
        ],
      });
    });
  });

  it('refuses a window over 31 days', async () => {
    await expect(
      service.freeSlots(
        'chef-1',
        new Date('2030-03-01T00:00:00Z'),
        new Date('2030-04-15T00:00:00Z'),
        180,
      ),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_FAILED' } });
  });
});
