import { Injectable } from '@nestjs/common';
import { Booking } from '../../generated/prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  list(): Promise<Booking[]> {
    return this.prisma.booking.findMany({ orderBy: { startsAt: 'asc' } });
  }

  async getMyBookingDetail(clerkUserId: string, bookingId: string) {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    return this.prisma.booking.findFirst({
      where: { id: bookingId, clientId: user.id },
      include: {
        bookingMeals: { include: { meal: true } },
        shoppingList: { include: { items: true } },
      },
    });
  }

  getAdminBookingDetail(bookingId: string) {
    return this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        client: true,
        bookingMeals: { include: { meal: true } },
        shoppingList: { include: { items: true } },
      },
    });
  }
}
