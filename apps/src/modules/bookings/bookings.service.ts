import { Injectable, NotFoundException } from '@nestjs/common';
import { Booking } from '../../generated/prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { CreateBookingDto } from './dto/create-booking.dto';

/**
 * Share of the TTC amount left to the client once the 50 % "service à la personne"
 * tax credit is applied (docs/SPEC-BACKEND.md §4.3).
 */
const TAX_CREDIT_RATE = 0.5;

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  list(): Promise<Booking[]> {
    return this.prisma.booking.findMany({ orderBy: { startsAt: 'asc' } });
  }

  /**
   * Minimal creation path: persist the booking so a card payment has something to
   * attach to. Shopping-list generation, notifications, and the `cooking`/`delivered`
   * transitions are deliberately out of scope for this phase.
   *
   * `chefId` is the preferred field name and wins over the legacy `providerId` when
   * both are sent (`create-booking.dto.ts` documents them as aliases).
   */
  async create(clerkUserId: string, payload: CreateBookingDto): Promise<Booking> {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    const chefProfileId = payload.chefId ?? payload.providerId;

    const chefProfile = await this.prisma.chefProfile.findUnique({
      where: { id: chefProfileId },
      select: { id: true },
    });
    if (!chefProfile) {
      throw new NotFoundException(`Chef profile ${chefProfileId} not found.`);
    }

    const serviceOffer = await this.prisma.serviceOffer.findUnique({
      where: { id: payload.serviceOfferId },
      select: { id: true, chefProfileId: true },
    });
    if (!serviceOffer) {
      throw new NotFoundException(`Service offer ${payload.serviceOfferId} not found.`);
    }

    const amountTtc = payload.priceCents;

    return this.prisma.booking.create({
      data: {
        reference: await this.nextReference(),
        clientId: user.id,
        chefProfileId: chefProfile.id,
        serviceOfferId: serviceOffer.id,
        startsAt: payload.startsAt,
        endsAt: payload.endsAt,
        status: 'pending',
        priceCents: payload.priceCents,
        amountTtc,
        amountAfterTax: Math.round(amountTtc * TAX_CREDIT_RATE),
        currency: payload.currency,
      },
    });
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

  /** `LF-<year>-NNNN`, same counting scheme as `QuotesService.nextReference()`. */
  private async nextReference(): Promise<string> {
    const year = new Date().getUTCFullYear();
    const prefix = `LF-${year}-`;
    const count = await this.prisma.booking.count({
      where: { reference: { startsWith: prefix } },
    });
    const sequence = String(count + 1).padStart(4, '0');
    return `${prefix}${sequence}`;
  }
}
