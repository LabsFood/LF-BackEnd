import { Injectable } from '@nestjs/common';

import { BookingStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';

/** A session that has not happened yet, or is happening: still ahead of the client. */
const AHEAD: BookingStatus[] = [
  BookingStatus.pending,
  BookingStatus.confirmed,
  BookingStatus.shopping,
  BookingStatus.cooking,
];

@Injectable()
export class StatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  /**
   * The client's home screen. `nextBooking` is the session ahead of them — one under
   * way today included, so it ends after now — with only what the screen shows.
   */
  async getMyDashboard(clerkUserId: string) {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    const [bookingsCount, quotesCount, next] = await Promise.all([
      this.prisma.booking.count({ where: { clientId: user.id } }),
      this.prisma.quote.count({ where: { clientId: user.id } }),
      this.prisma.booking.findFirst({
        where: { clientId: user.id, status: { in: AHEAD }, endsAt: { gte: new Date() } },
        orderBy: { startsAt: 'asc' },
        select: {
          id: true,
          reference: true,
          startsAt: true,
          endsAt: true,
          status: true,
          chefProfile: { select: { displayName: true } },
        },
      }),
    ]);

    return {
      bookingsCount,
      quotesCount,
      nextBooking: next && {
        id: next.id,
        reference: next.reference,
        startsAt: next.startsAt,
        endsAt: next.endsAt,
        status: next.status,
        chefName: next.chefProfile.displayName,
      },
    };
  }

  /** Cancelled bookings were never owed: they stay out of the totals. */
  async getMyStats(clerkUserId: string) {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    const [bookings, quotes] = await Promise.all([
      this.prisma.booking.aggregate({
        where: { clientId: user.id, status: { not: BookingStatus.cancelled } },
        _sum: { amountTtc: true, amountAfterTax: true },
        _count: { _all: true },
      }),
      this.prisma.quote.groupBy({
        by: ['status'],
        where: { clientId: user.id },
        _count: { _all: true },
      }),
    ]);

    return {
      totals: {
        bookings: bookings._count._all,
        amountTtc: bookings._sum.amountTtc ?? 0,
        amountAfterTax: bookings._sum.amountAfterTax ?? 0,
      },
      quotesByStatus: Object.fromEntries(
        quotes.map((group) => [group.status, group._count._all]),
      ),
    };
  }

  async getAdminDashboard() {
    const [revenueAgg, bookingsByStatus, formuleSplit, topMeals] = await Promise.all([
      this.prisma.booking.aggregate({
        _sum: { amountTtc: true, amountAfterTax: true, priceCents: true },
      }),
      this.prisma.booking.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.booking.groupBy({
        by: ['formuleId'],
        _count: { _all: true },
        where: { formuleId: { not: null } },
      }),
      // Lab's Food meals only, as before chefs owned dishes. Counting chef dishes
      // too is a change of meaning, not a fix: drop the filter when that is wanted.
      this.prisma.bookingMeal.groupBy({
        by: ['mealId'],
        where: { meal: { chefProfileId: null } },
        _sum: { portions: true },
        orderBy: { _sum: { portions: 'desc' } },
        take: 5,
      }),
    ]);

    return {
      revenue: revenueAgg._sum,
      sessionsByStatus: bookingsByStatus,
      formuleSplit,
      topMeals,
    };
  }
}
