import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  bookingAmounts,
  shoppingFee,
  supplementRulesInForce,
  supplementsFor,
} from '../bookings/domain/pricing';
import { CUSTOM_OFFER_NAME } from '../quotes/quote-offers.service';
import { UsersService } from '../users/users.service';
import {
  CreateServiceOfferDto,
  OfferPriceQueryDto,
  UpdateServiceOfferDto,
} from './dto/service-offer.dto';

const SELECT = {
  id: true,
  name: true,
  description: true,
  durationMinutes: true,
  priceCents: true,
  currency: true,
  shoppingIncluded: true,
  shoppingFeeCents: true,
  isActive: true,
} satisfies Prisma.ServiceOfferSelect;

type Row = Prisma.ServiceOfferGetPayload<{ select: typeof SELECT }>;

function view(row: Row) {
  const { isActive, ...rest } = row;
  return { ...rest, active: isActive };
}

function unprocessable(code: string, message: string) {
  return new UnprocessableEntityException({ code, message });
}

/** The prices and durations a batch cooker sells; a client books one of them. */
@Injectable()
export class ServiceOffersService {
  private readonly logger = new Logger(ServiceOffersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  async list(clerkUserId: string) {
    const chef = await this.users.chefIdentity(clerkUserId);
    const rows = await this.prisma.serviceOffer.findMany({
      // The hidden offer behind accepted custom quotes is not the chef's to manage.
      where: { chefProfileId: chef.chefProfileId, name: { not: CUSTOM_OFFER_NAME } },
      orderBy: [{ isActive: 'desc' }, { priceCents: 'asc' }, { createdAt: 'asc' }],
      select: SELECT,
    });
    return rows.map(view);
  }

  /**
   * `GET /admin/service-offers`: every batch cooker's offers, for the back office, with
   * the cook and how many bookings each carries. The custom-quote line is left out, as on
   * the chef's own list: it is plumbing, not something the cook sells.
   *
   * ponytail: unpaginated, fine for a few hundred offers. Add `?chefProfileId=` and paging
   * when the catalogue outgrows one page.
   */
  async listAll() {
    const rows = await this.prisma.serviceOffer.findMany({
      where: { name: { not: CUSTOM_OFFER_NAME } },
      orderBy: [
        { chefProfile: { displayName: 'asc' } },
        { isActive: 'desc' },
        { priceCents: 'asc' },
      ],
      select: {
        ...SELECT,
        chefProfile: { select: { id: true, displayName: true } },
        _count: { select: { bookings: true } },
      },
    });
    return rows.map(({ chefProfile, _count, ...row }) => ({
      ...view(row),
      chef: chefProfile,
      bookingsCount: _count.bookings,
    }));
  }

  async create(clerkUserId: string, dto: CreateServiceOfferDto) {
    const chef = await this.users.chefIdentity(clerkUserId);
    this.assertName(dto.name);
    this.assertShopping(dto.shoppingIncluded ?? false, dto.shoppingFeeCents ?? 0);
    const row = await this.prisma.serviceOffer.create({
      data: {
        chefProfileId: chef.chefProfileId,
        name: dto.name.trim(),
        description: dto.description ?? null,
        durationMinutes: dto.durationMinutes,
        priceCents: dto.priceCents,
        shoppingIncluded: dto.shoppingIncluded ?? false,
        shoppingFeeCents: dto.shoppingFeeCents ?? 0,
        isActive: dto.active ?? true,
      },
      select: SELECT,
    });
    this.logger.log({
      event: 'service_offer.created',
      chefProfileId: chef.chefProfileId,
      offerId: row.id,
      durationMinutes: row.durationMinutes,
      priceCents: row.priceCents,
    });
    return view(row);
  }

  async update(clerkUserId: string, id: string, dto: UpdateServiceOfferDto) {
    const chef = await this.users.chefIdentity(clerkUserId);
    const current = await this.owned(chef.chefProfileId, id);
    if (dto.name !== undefined) this.assertName(dto.name);
    this.assertShopping(
      dto.shoppingIncluded ?? current.shoppingIncluded,
      // Switching shopping off clears a fee the chef did not resend.
      dto.shoppingFeeCents ??
        (dto.shoppingIncluded === false ? 0 : current.shoppingFeeCents),
    );
    const shoppingFeeCents =
      dto.shoppingIncluded === false ? 0 : (dto.shoppingFeeCents ?? undefined);
    const row = await this.prisma.serviceOffer.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        description: dto.description,
        durationMinutes: dto.durationMinutes,
        priceCents: dto.priceCents,
        shoppingIncluded: dto.shoppingIncluded,
        shoppingFeeCents,
        isActive: dto.active,
      },
      select: SELECT,
    });
    this.logger.log({
      event: 'service_offer.updated',
      chefProfileId: chef.chefProfileId,
      offerId: id,
      fields: Object.keys(dto),
    });
    return view(row);
  }

  async remove(clerkUserId: string, id: string): Promise<void> {
    const chef = await this.users.chefIdentity(clerkUserId);
    await this.owned(chef.chefProfileId, id);
    // A booking keeps its offer for the duration and price it was made with.
    const bookings = await this.prisma.booking.count({ where: { serviceOfferId: id } });
    if (bookings > 0) {
      this.logger.warn({
        event: 'service_offer.delete_refused',
        chefProfileId: chef.chefProfileId,
        offerId: id,
        bookings,
      });
      throw new ConflictException({
        code: 'OFFER_IN_USE',
        message: 'This offer has bookings: turn it off (`active: false`) instead.',
      });
    }
    await this.prisma.serviceOffer.delete({ where: { id } });
    this.logger.log({
      event: 'service_offer.deleted',
      chefProfileId: chef.chefProfileId,
      offerId: id,
    });
  }

  /**
   * Public: what a booking of this offer would cost, line by line, computed as
   * `POST /me/bookings` will. The front shows these amounts and never adds its own.
   */
  async price(id: string, query: OfferPriceQueryDto) {
    const offer = await this.prisma.serviceOffer.findFirst({
      where: { id, isActive: true, chefProfile: { isActive: true, isVerified: true } },
      select: {
        id: true,
        priceCents: true,
        currency: true,
        shoppingIncluded: true,
        shoppingFeeCents: true,
      },
    });
    if (!offer) {
      throw new NotFoundException({
        code: 'OFFER_NOT_FOUND',
        message: 'Offer not found.',
      });
    }
    const rules = await supplementRulesInForce(this.prisma);
    return {
      serviceOfferId: offer.id,
      currency: offer.currency,
      ...bookingAmounts(
        offer.priceCents,
        supplementsFor(
          {
            persons: query.persons,
            extraMeals: query.extraMeals ?? 0,
            shoppingFeeCents: shoppingFee(offer, query.shoppingByClient ?? false),
            formule: false,
          },
          rules,
        ),
      ),
      rules,
    };
  }

  /** The caller's own offer; someone else's, or the hidden custom one, is a 404. */
  private async owned(chefProfileId: string, id: string) {
    const row = await this.prisma.serviceOffer.findFirst({
      where: { id, chefProfileId, name: { not: CUSTOM_OFFER_NAME } },
      select: SELECT,
    });
    if (!row) {
      throw new NotFoundException({
        code: 'OFFER_NOT_FOUND',
        message: 'Offer not found.',
      });
    }
    return row;
  }

  private assertName(name: string) {
    if (name.trim() === '' || name.trim() === CUSTOM_OFFER_NAME) {
      throw unprocessable('OFFER_NAME_INVALID', 'Choose another name for this offer.');
    }
  }

  private assertShopping(included: boolean, feeCents: number) {
    if (!included && feeCents > 0) {
      throw unprocessable(
        'SHOPPING_FEE_WITHOUT_SHOPPING',
        '`shoppingFeeCents` needs `shoppingIncluded`.',
      );
    }
  }
}
