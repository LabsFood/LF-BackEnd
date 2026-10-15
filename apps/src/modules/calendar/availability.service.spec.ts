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
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      booking: { findMany: jest.fn().mockResolvedValue([]) },
      chefTimeBlock: { findMany: jest.fn().mockResolvedValue([]) },
      serviceOffer: { findFirst: jest.fn(), groupBy: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(),
      $queryRaw: jest.fn(),
    } as never;
    prisma.$transaction.mockImplementation((work: (tx: unknown) => unknown) =>
      work(prisma),
    );
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
        status: {
          in: ['pending', 'confirmed', 'shopping', 'cooking', 'delivered', 'disputed'],
        },
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
    it('refuses two ranges of one day that overlap, naming the day', async () => {
      await expect(
        service.replaceSchedule('clerk_1', {
          weekly: [
            { weekday: 0, startMinute: 540, endMinute: 780 },
            { weekday: 0, startMinute: 720, endMinute: 900 },
          ],
          exceptions: [],
        }),
      ).rejects.toMatchObject({
        response: { code: 'SCHEDULE_OVERLAP', details: { weekday: 0 } },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses a range that ends before it starts, naming the date', async () => {
      await expect(
        service.replaceSchedule('clerk_1', {
          weekly: [],
          exceptions: [
            { date: '2030-12-23', kind: 'extra', startMinute: 900, endMinute: 840 },
          ],
        }),
      ).rejects.toMatchObject({
        response: { code: 'RANGE_INVALID', details: { date: '2030-12-23' } },
      });
    });

    it('refuses a date both closed and with extra hours: a closed day wins', async () => {
      await expect(
        service.replaceSchedule('clerk_1', {
          weekly: [],
          exceptions: [
            { date: '2030-12-24', kind: 'closed' },
            { date: '2030-12-24', kind: 'extra', startMinute: 840, endMinute: 900 },
          ],
        }),
      ).rejects.toMatchObject({
        response: { code: 'SCHEDULE_CONFLICT', details: { date: '2030-12-24' } },
      });
    });

    it('refuses a save from a stale tab', async () => {
      await expect(
        service.replaceSchedule('clerk_1', {
          weekly: MORNINGS,
          exceptions: [],
          version: 'stale',
        }),
      ).rejects.toMatchObject({ response: { code: 'SCHEDULE_CHANGED' } });
      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(prisma.chefWorkingHour.deleteMany).not.toHaveBeenCalled();
    });

    it('saves when the version read is still current, and answers ids', async () => {
      prisma.chefWorkingHour.findMany.mockResolvedValue([{ id: 'w1', ...MORNINGS[0] }]);
      const { version } = await service.scheduleOf('chef-1');

      const saved = await service.replaceSchedule('clerk_1', {
        weekly: [{ id: 'w1', ...MORNINGS[0] }],
        exceptions: [],
        version,
      });

      expect(prisma.chefWorkingHour.createMany).toHaveBeenCalledWith({
        data: [{ chefProfileId: 'chef-1', ...MORNINGS[0] }],
      });
      expect(saved.weekly[0]).toMatchObject({ id: 'w1', weekday: 1 });
      expect(saved.version).toBe(version);
    });

    it('keeps past exceptions: only today on is replaced', async () => {
      await service.replaceSchedule('clerk_1', {
        weekly: [],
        exceptions: [{ date: '2020-01-01', kind: 'closed' }],
      });

      expect(prisma.chefAvailabilityException.deleteMany).toHaveBeenCalledWith({
        where: { chefProfileId: 'chef-1', date: { gte: expect.any(Date) } },
      });
      expect(prisma.chefAvailabilityException.createMany).toHaveBeenCalledWith({
        data: [],
      });
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

  describe('blocks and closed days', () => {
    it('treats a block as busy', async () => {
      prisma.chefTimeBlock.findMany.mockResolvedValueOnce([
        {
          startsAt: new Date('2030-03-12T09:00:00Z'),
          endsAt: new Date('2030-03-12T09:30:00Z'),
        },
      ]);
      await expect(service.assertBookable('chef-1', START, END)).rejects.toMatchObject({
        response: { code: 'SLOT_UNAVAILABLE' },
      });
    });

    it('refuses a request on a closed day', async () => {
      prisma.chefAvailabilityException.findFirst.mockResolvedValueOnce({ id: 'x1' });
      const day = new Date('2030-12-24T00:00:00Z');

      await expect(service.assertOpenOn('chef-1', day)).rejects.toMatchObject({
        response: { code: 'CHEF_CLOSED_ON_DATE' },
      });
      expect(prisma.chefAvailabilityException.findFirst).toHaveBeenCalledWith({
        where: { chefProfileId: 'chef-1', date: day, kind: 'closed' },
        select: { id: true },
      });
    });
  });

  describe('public slots', () => {
    const OFFER = {
      id: 'o-big',
      name: 'Grande séance',
      durationMinutes: 180,
      priceCents: 24_000,
    };

    it('books the most expensive active offer when the page names none', async () => {
      prisma.serviceOffer.findFirst.mockResolvedValue(OFFER);

      const answer = await service.publicSlots('chef-1', {
        from: new Date('2030-03-11T23:00:00Z'),
        to: new Date('2030-03-12T23:00:00Z'),
      });

      const query = prisma.serviceOffer.findFirst.mock.calls[0][0];
      expect(query.where).not.toHaveProperty('id');
      expect(query.orderBy).toEqual([
        { priceCents: 'desc' },
        { durationMinutes: 'asc' },
        { createdAt: 'asc' },
      ]);
      expect(answer.offer).toEqual(OFFER);
      expect(answer.slots[0]).toEqual(new Date('2030-03-12T07:00:00Z')); // 8:00 Paris
    });

    it('404s when the batch cooker has no active offer', async () => {
      prisma.serviceOffer.findFirst.mockResolvedValue(null);

      await expect(
        service.publicSlots('chef-1', {
          from: new Date('2030-03-11T23:00:00Z'),
          to: new Date('2030-03-12T23:00:00Z'),
        }),
      ).rejects.toMatchObject({ response: { code: 'OFFER_NOT_FOUND' } });
    });
  });

  describe('slotsLeftFor', () => {
    // Tuesday 12 March 2030, Paris: 8:00–13:00, five free hours.
    const FROM = new Date('2030-03-11T23:00:00Z');
    const TO = new Date('2030-03-12T23:00:00Z');
    const hours = (chefProfileId: string) => ({ chefProfileId, ...MORNINGS[0] });
    const shortest = (chefProfileId: string, minutes: number) => ({
      chefProfileId,
      _min: { durationMinutes: minutes },
    });

    it('counts whole sessions of the shortest offer: 5 h with 2 h 30 is 2, with 4 h is 1', async () => {
      prisma.chefWorkingHour.findMany.mockResolvedValue([hours('a'), hours('b')]);
      prisma.serviceOffer.groupBy.mockResolvedValue([
        shortest('a', 150),
        shortest('b', 240),
      ]);

      const left = await service.slotsLeftFor(['a', 'b'], FROM, TO);

      expect(left.get('a')).toBe(2);
      expect(left.get('b')).toBe(1);
      expect(prisma.serviceOffer.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ _min: { durationMinutes: true } }),
      );
    });

    it('is 0 when prestations and blocks fill the day', async () => {
      prisma.chefWorkingHour.findMany.mockResolvedValue([hours('a')]);
      prisma.serviceOffer.groupBy.mockResolvedValue([shortest('a', 150)]);
      prisma.booking.findMany.mockResolvedValue([
        {
          chefProfileId: 'a',
          startsAt: new Date('2030-03-12T07:00:00Z'),
          endsAt: new Date('2030-03-12T09:30:00Z'),
        },
      ]);
      prisma.chefTimeBlock.findMany.mockResolvedValue([
        {
          chefProfileId: 'a',
          startsAt: new Date('2030-03-12T09:30:00Z'),
          endsAt: new Date('2030-03-12T12:00:00Z'),
        },
      ]);

      expect((await service.slotsLeftFor(['a'], FROM, TO)).get('a')).toBe(0);
    });

    it('is null without hours or without an active offer: on request', async () => {
      prisma.chefWorkingHour.findMany.mockResolvedValue([hours('no-offer')]);
      prisma.serviceOffer.groupBy.mockResolvedValue([shortest('no-hours', 150)]);

      const left = await service.slotsLeftFor(['no-offer', 'no-hours'], FROM, TO);

      expect(left.get('no-offer')).toBeNull();
      expect(left.get('no-hours')).toBeNull();
    });

    it('reads each table once, however many batch cookers', async () => {
      await service.slotsLeftFor(['a', 'b', 'c', 'd'], FROM, TO);

      expect(prisma.chefWorkingHour.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.booking.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.chefTimeBlock.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.serviceOffer.groupBy).toHaveBeenCalledTimes(1);
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
