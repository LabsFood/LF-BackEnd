import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class StatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  async getMyDashboard(clerkUserId: string) {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    const [bookingsCount, quotesCount, latestBooking] = await Promise.all([
      this.prisma.booking.count({ where: { clientId: user.id } }),
      this.prisma.quote.count({ where: { clientId: user.id } }),
      this.prisma.booking.findFirst({
        where: { clientId: user.id },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      bookingsCount,
      quotesCount,
      latestBooking,
    };
  }

  async getMyStats(clerkUserId: string) {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    const [bookingAgg, quoteAgg] = await Promise.all([
      this.prisma.booking.aggregate({
        where: { clientId: user.id },
        _sum: { amountTtc: true, priceCents: true },
        _count: { _all: true },
      }),
      this.prisma.quote.groupBy({
        by: ['status'],
        where: { clientId: user.id },
        _count: { _all: true },
      }),
    ]);

    return {
      totals: bookingAgg,
      quotesByStatus: quoteAgg,
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
