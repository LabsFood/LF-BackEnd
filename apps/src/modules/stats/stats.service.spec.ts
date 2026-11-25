import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { StatsService } from './stats.service';

describe('StatsService', () => {
  it("ranks top meals among Lab's Food meals only", async () => {
    const groupBy = jest.fn().mockResolvedValue([]);
    const prisma = {
      booking: {
        aggregate: jest.fn().mockResolvedValue({ _sum: {} }),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      bookingMeal: { groupBy },
    } as unknown as PrismaService;
    const service = new StatsService(prisma, {} as UsersService);

    await service.getAdminDashboard();

    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { meal: { chefProfileId: null } } }),
    );
  });

  describe('client figures', () => {
    const users = {
      ensurePersistedFromClerk: jest.fn().mockResolvedValue({ id: 'user-1' }),
    } as unknown as UsersService;

    it('gives the session ahead, with only what the home screen shows', async () => {
      const findFirst = jest.fn().mockResolvedValue({
        id: 'booking-1',
        reference: 'LF-2026-0001',
        startsAt: new Date('2026-11-02T09:00:00.000Z'),
        endsAt: new Date('2026-11-02T12:00:00.000Z'),
        status: 'confirmed',
        chefProfile: { displayName: 'Awa Diallo' },
      });
      const prisma = {
        booking: { count: jest.fn().mockResolvedValue(3), findFirst },
        quote: { count: jest.fn().mockResolvedValue(1) },
      } as unknown as PrismaService;

      const dashboard = await new StatsService(prisma, users).getMyDashboard('clerk_1');

      expect(dashboard).toEqual({
        bookingsCount: 3,
        quotesCount: 1,
        nextBooking: {
          id: 'booking-1',
          reference: 'LF-2026-0001',
          startsAt: new Date('2026-11-02T09:00:00.000Z'),
          endsAt: new Date('2026-11-02T12:00:00.000Z'),
          status: 'confirmed',
          chefName: 'Awa Diallo',
        },
      });
      // Ahead of the client: not cancelled or finished, and not over yet.
      const query = findFirst.mock.calls[0][0];
      expect(query.where.status.in).toEqual([
        'pending',
        'confirmed',
        'shopping',
        'cooking',
      ]);
      expect(query.where.endsAt.gte).toBeInstanceOf(Date);
      expect(query.orderBy).toEqual({ startsAt: 'asc' });
    });

    it('says `null` when no session is ahead', async () => {
      const prisma = {
        booking: {
          count: jest.fn().mockResolvedValue(0),
          findFirst: jest.fn().mockResolvedValue(null),
        },
        quote: { count: jest.fn().mockResolvedValue(0) },
      } as unknown as PrismaService;

      const dashboard = await new StatsService(prisma, users).getMyDashboard('clerk_1');

      expect(dashboard.nextBooking).toBeNull();
    });

    it('adds up the bookings without the cancelled ones, and counts quotes by status', async () => {
      const aggregate = jest.fn().mockResolvedValue({
        _count: { _all: 2 },
        _sum: { amountTtc: 29700, amountAfterTax: null },
      });
      const prisma = {
        booking: { aggregate },
        quote: {
          groupBy: jest.fn().mockResolvedValue([
            { status: 'quoted', _count: { _all: 1 } },
            { status: 'submitted', _count: { _all: 2 } },
          ]),
        },
      } as unknown as PrismaService;

      const stats = await new StatsService(prisma, users).getMyStats('clerk_1');

      expect(stats).toEqual({
        totals: { bookings: 2, amountTtc: 29700, amountAfterTax: 0 },
        quotesByStatus: { quoted: 1, submitted: 2 },
      });
      expect(aggregate.mock.calls[0][0].where).toEqual({
        clientId: 'user-1',
        status: { not: 'cancelled' },
      });
    });
  });
});
