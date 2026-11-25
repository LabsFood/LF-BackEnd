import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { AgendaService, MAX_BLOCKS_AHEAD } from './agenda.service';
import { AvailabilityService } from './availability.service';

const FROM = new Date('2030-03-09T23:00:00Z'); // Monday 10 March, Paris
const TO = new Date('2030-03-16T23:00:00Z');

const quote = (over: Record<string, unknown> = {}) => ({
  id: 'q1',
  reference: 'DEM-2030-0001',
  title: 'Anniversaire',
  status: 'submitted',
  persons: 8,
  addressCity: 'Lyon',
  desiredDate: new Date('2030-03-12T00:00:00Z'),
  timeSlot: 'morning',
  client: { fullName: 'Karim Benali' },
  offers: [],
  ...over,
});

describe('AgendaService', () => {
  let prisma: Record<string, Record<string, jest.Mock>>;
  let availability: { scheduleOf: jest.Mock };
  let service: AgendaService;

  beforeEach(() => {
    prisma = {
      chefAvailabilityException: { findMany: jest.fn().mockResolvedValue([]) },
      booking: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      quote: { findMany: jest.fn().mockResolvedValue([]) },
      chefTimeBlock: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: 'blk-1', ...data })),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    availability = {
      scheduleOf: jest.fn().mockResolvedValue({
        weekly: [],
        exceptions: [],
        version: 'v1',
        scheduled: false,
      }),
    };
    const users = {
      chefIdentity: jest
        .fn()
        .mockResolvedValue({ userId: 'chef-user', chefProfileId: 'chef-1' }),
    };
    service = new AgendaService(
      prisma as unknown as PrismaService,
      users as unknown as UsersService,
      availability as unknown as AvailabilityService,
    );
  });

  describe('read', () => {
    it('reads only this batch cooker, and leaves cancelled prestations out', async () => {
      await service.read('clerk_1', { from: FROM, to: TO });

      expect(prisma.booking.findMany.mock.calls[0][0].where).toEqual({
        chefProfileId: 'chef-1',
        startsAt: { lt: TO },
        endsAt: { gt: FROM },
        status: { not: 'cancelled' },
      });
      expect(prisma.quote.findMany.mock.calls[0][0].where).toEqual({
        assignedChefUserId: 'chef-user',
        status: { in: ['submitted', 'in_review', 'declined', 'quoted'] },
      });
      expect(prisma.chefTimeBlock.findMany.mock.calls[0][0].where).toMatchObject({
        chefProfileId: 'chef-1',
      });
    });

    it('shows a prestation with its city and the client by first name and initial', async () => {
      prisma.booking.findMany.mockResolvedValue([
        {
          id: 'b1',
          reference: 'LF-2030-0001',
          status: 'confirmed',
          startsAt: new Date('2030-03-11T08:00:00Z'),
          endsAt: new Date('2030-03-11T11:00:00Z'),
          timeSlot: '09:00-12:00',
          persons: 4,
          addressCity: 'Paris',
          client: { fullName: 'Sophie Marchand' },
          reschedules: [{ toStartsAt: new Date('2030-03-13T08:00:00Z') }],
        },
      ]);

      const { prestations } = await service.read('clerk_1', { from: FROM, to: TO });

      expect(prestations[0]).toMatchObject({
        city: 'Paris',
        client: { name: 'Sophie M.' },
      });
      expect(JSON.stringify(prestations)).not.toContain('Marchand');
    });

    it('puts a request at the time its open offer proposes', async () => {
      prisma.quote.findMany.mockResolvedValue([
        quote({
          status: 'quoted',
          offers: [
            {
              proposedDate: new Date('2030-03-14T00:00:00Z'),
              proposedTimeSlot: 'evening',
            },
          ],
        }),
      ]);

      const { requests } = await service.read('clerk_1', { from: FROM, to: TO });

      expect(requests[0]).toMatchObject({
        stage: 'offer_sent',
        city: 'Lyon',
        client: { name: 'Karim B.' },
        startsAt: new Date('2030-03-14T17:00:00Z'), // 18:00 in Paris
        endsAt: new Date('2030-03-14T21:00:00Z'),
      });
    });

    it('puts a request still to answer at the time asked', async () => {
      prisma.quote.findMany.mockResolvedValue([quote()]);

      const { requests } = await service.read('clerk_1', { from: FROM, to: TO });

      expect(requests[0]).toMatchObject({
        stage: 'to_answer',
        startsAt: new Date('2030-03-12T08:00:00Z'), // 09:00 in Paris
      });
    });

    it('keeps a request without a date, with no time', async () => {
      prisma.quote.findMany.mockResolvedValue([quote({ desiredDate: null })]);

      const { requests } = await service.read('clerk_1', { from: FROM, to: TO });

      expect(requests[0]).toMatchObject({ startsAt: null, endsAt: null });
    });

    it('leaves out a request outside the window', async () => {
      prisma.quote.findMany.mockResolvedValue([
        quote({ desiredDate: new Date('2030-04-20T00:00:00Z') }),
      ]);

      const { requests } = await service.read('clerk_1', { from: FROM, to: TO });

      expect(requests).toEqual([]);
    });

    it('refuses more than 42 days', async () => {
      await expect(
        service.read('clerk_1', {
          from: FROM,
          to: new Date(FROM.getTime() + 43 * 86_400_000),
        }),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_FAILED' } });
    });
  });

  describe('summary', () => {
    it('counts by the Paris month of the start', async () => {
      prisma.booking.findMany.mockResolvedValue([
        // 23:30 on 31 March in Paris (21:30 UTC): March.
        { startsAt: new Date('2030-03-31T21:30:00Z') },
        // 00:30 on 1 April in Paris, still 31 March in UTC: April.
        { startsAt: new Date('2030-03-31T22:30:00Z') },
      ]);

      const { months } = await service.summary('clerk_1', 2030);

      expect(months[2]).toEqual({ month: 3, prestations: 1 });
      expect(months[3]).toEqual({ month: 4, prestations: 1 });
      expect(prisma.booking.findMany.mock.calls[0][0].where).toMatchObject({
        chefProfileId: 'chef-1',
        status: { not: 'cancelled' },
        startsAt: {
          gte: new Date('2029-12-31T23:00:00Z'),
          lt: new Date('2030-12-31T23:00:00Z'),
        },
      });
    });
  });

  describe('blocks', () => {
    const block = {
      startsAt: new Date(Date.now() + 86_400_000),
      endsAt: new Date(Date.now() + 90_000_000),
    };

    it('refuses a block over a prestation', async () => {
      prisma.booking.count.mockResolvedValue(1);

      await expect(service.addBlock('clerk_1', block)).rejects.toMatchObject({
        response: { code: 'BLOCK_OVERLAPS_BOOKING' },
      });
      expect(prisma.chefTimeBlock.create).not.toHaveBeenCalled();
    });

    it(`keeps ${MAX_BLOCKS_AHEAD} blocks ahead at most`, async () => {
      prisma.chefTimeBlock.count.mockResolvedValue(MAX_BLOCKS_AHEAD);

      await expect(service.addBlock('clerk_1', block)).rejects.toMatchObject({
        response: { code: 'TOO_MANY_BLOCKS' },
      });
    });

    it('takes the same block twice for a double click', async () => {
      prisma.chefTimeBlock.findFirst.mockResolvedValue({ id: 'blk-0', ...block });

      const result = await service.addBlock('clerk_1', block);

      expect(result.id).toBe('blk-0');
      expect(prisma.chefTimeBlock.create).not.toHaveBeenCalled();
    });

    it('returns the first block when two clicks race', async () => {
      prisma.chefTimeBlock.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'blk-0', ...block });
      prisma.chefTimeBlock.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      expect((await service.addBlock('clerk_1', block)).id).toBe('blk-0');
    });

    it('refuses a block that ends before it starts, or is over', async () => {
      await expect(
        service.addBlock('clerk_1', { startsAt: block.endsAt, endsAt: block.startsAt }),
      ).rejects.toMatchObject({ response: { code: 'RANGE_INVALID' } });
      await expect(
        service.addBlock('clerk_1', {
          startsAt: new Date('2020-01-01T08:00:00Z'),
          endsAt: new Date('2020-01-01T09:00:00Z'),
        }),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_FAILED' } });
    });

    it("cannot remove another batch cooker's block", async () => {
      prisma.chefTimeBlock.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.removeBlock('clerk_1', 'blk-9')).rejects.toMatchObject({
        response: { code: 'BLOCK_NOT_FOUND' },
      });
      expect(prisma.chefTimeBlock.deleteMany).toHaveBeenCalledWith({
        where: { id: 'blk-9', chefProfileId: 'chef-1' },
      });
    });
  });
});
