import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Booking } from '../../generated/prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { CHEF_CESU_INFO_SELECT, toChefCesuInfo } from '../payments/chef-cesu-info';
import { assertNoCommissionBlock } from '../payments/commission-standing';
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
    private readonly config: ConfigService,
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
   *
   * ponytail: booking only ever reaches `pending`/`confirmed` here. Shopping-list
   * generation, client/chef notifications, and the `cooking`/`delivered` transitions are
   * unbuilt — add them (and their own service methods) when the booking lifecycle needs
   * to move past payment.
   */
  async create(clerkUserId: string, payload: CreateBookingDto): Promise<Booking> {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    const chefProfileId = payload.chefId ?? payload.providerId;

    const chefProfile = await this.prisma.chefProfile.findUnique({
      where: { id: chefProfileId },
      select: { id: true, isActive: true, isVerified: true },
    });
    if (!chefProfile) {
      throw new NotFoundException(`Chef profile ${chefProfileId} not found.`);
    }
    // Admin vetting gates bookability. Without this a self-registered chef is
    // bookable the moment they save a profile, and the booking is a dead end —
    // `POST /payments/intent` refuses to move money to an unvetted chef.
    if (!chefProfile.isActive || !chefProfile.isVerified) {
      throw new ConflictException(
        `Chef profile ${chefProfileId} is not open for bookings yet (pending admin verification).`,
      );
    }
    // A chef whose commission could not be collected stops taking on new work. This is
    // the counterweight to accepting Stripe's SEPA CORE scheme, where the chef can revoke
    // a debit for eight weeks with no justification: rather than trying to make the debit
    // safe, the exposure is capped at what is already owed.
    await assertNoCommissionBlock(
      this.prisma,
      chefProfile.id,
      this.config.getOrThrow<number>('payments.commissionDebitMaxAttempts'),
    );

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

  /**
   * The booking page carries the chef's CESU coordinates under `chefCesu`.
   *
   * A client pays prefinanced CESU from their issuer's beneficiary area, and can only do
   * so after adding the chef as an intervenant with their NAN — so the number has to be
   * readable **before** the payment. Invoice A cannot carry it: it is only issued once
   * the service has been delivered.
   */
  async getMyBookingDetail(clerkUserId: string, bookingId: string) {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, clientId: user.id },
      include: {
        bookingMeals: { include: { meal: true } },
        shoppingList: { include: { items: true } },
        chefProfile: { select: CHEF_CESU_INFO_SELECT },
      },
    });
    if (!booking) {
      return null;
    }

    const { chefProfile, ...rest } = booking;
    return { ...rest, chefCesu: toChefCesuInfo(chefProfile) };
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
