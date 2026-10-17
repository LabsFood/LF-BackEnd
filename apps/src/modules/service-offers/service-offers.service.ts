import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CUSTOM_OFFER_NAME } from '../quotes/quote-offers.service';
import { UsersService } from '../users/users.service';
import { CreateServiceOfferDto, UpdateServiceOfferDto } from './dto/service-offer.dto';

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
