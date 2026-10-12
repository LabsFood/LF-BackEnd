import { Injectable } from '@nestjs/common';
import { Booking } from '../../generated/prisma/client';

import {
  buildPaginationMeta,
  resolvePageBounds,
  type Paginated,
  type PaginationQueryDto,
} from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { RECIPE_FIELDS } from '../catalog/catalog.service';
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

  /** The caller's own bookings, as client or as batch cooker, one page at a time. */
  async listMine(
    clerkUserId: string,
    query: PaginationQueryDto = {},
  ): Promise<Paginated<Booking>> {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    const bounds = resolvePageBounds(query);
    const where = {
      OR: [{ clientId: user.id }, { chefProfile: { userId: user.id } }],
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({
        where,
        orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
        skip: bounds.skip,
        take: bounds.take,
      }),
      this.prisma.booking.count({ where }),
    ]);
    return { data, meta: buildPaginationMeta(bounds, total) };
  }

  async getMyBookingDetail(clerkUserId: string, bookingId: string) {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    return this.prisma.booking.findFirst({
      where: { id: bookingId, clientId: user.id },
      include: {
        // The client gets the recipe on the fiche, after the prestation (FLOW-02 §8).
        bookingMeals: {
          include: { meal: { omit: RECIPE_FIELDS } },
        },
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
