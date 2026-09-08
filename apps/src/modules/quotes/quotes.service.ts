import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import {
  CHEF_CESU_INFO_SELECT,
  type ChefCesuInfo,
  toChefCesuInfo,
} from '../payments/chef-cesu-info';
import { UsersService } from '../users/users.service';
import { CreateQuoteDto, UpdateQuoteAdminDto } from './dto/quote.dto';

@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  async createQuote(clerkUserId: string, payload: CreateQuoteDto) {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    return this.prisma.quote.create({
      data: {
        reference: await this.nextReference(),
        clientId: user.id,
        title: payload.title,
        persons: payload.persons,
        mealsCount: payload.mealsCount,
        cuisine: payload.cuisine,
        diet: payload.diet ?? [],
        brief: payload.brief,
      },
    });
  }

  /**
   * Each quote carries the assigned chef's CESU coordinates under `chefCesu`, so a client
   * who intends to pay in prefinanced CESU can add the chef as an intervenant on their
   * issuer portal from the quote onwards — well before any invoice exists. `null` until a
   * chef is assigned.
   *
   * `assignedChefUserId` is a bare column, not a Prisma relation, so the chefs are
   * resolved in one extra query rather than through an include.
   */
  async listMyQuotes(clerkUserId: string) {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    const quotes = await this.prisma.quote.findMany({
      where: { clientId: user.id },
      orderBy: { createdAt: 'desc' },
    });

    const chefUserIds = [
      ...new Set(
        quotes
          .map((quote) => quote.assignedChefUserId)
          .filter((id): id is string => id !== null),
      ),
    ];
    if (chefUserIds.length === 0) {
      return quotes.map((quote) => ({ ...quote, chefCesu: null }));
    }

    const chefs = await this.prisma.chefProfile.findMany({
      where: { userId: { in: chefUserIds } },
      select: { ...CHEF_CESU_INFO_SELECT, userId: true },
    });
    const byUserId = new Map<string, ChefCesuInfo>(
      chefs.map((chef) => [chef.userId, toChefCesuInfo(chef)]),
    );

    return quotes.map((quote) => ({
      ...quote,
      chefCesu: quote.assignedChefUserId
        ? (byUserId.get(quote.assignedChefUserId) ?? null)
        : null,
    }));
  }

  async acceptMyQuote(clerkUserId: string, id: string) {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    const quote = await this.prisma.quote.findFirst({ where: { id, clientId: user.id } });
    if (!quote) {
      throw new NotFoundException('Quote not found.');
    }
    return this.prisma.quote.update({
      where: { id: quote.id },
      data: { status: 'accepted' as never },
    });
  }

  listAdminQuotes(status?: string) {
    return this.prisma.quote.findMany({
      where: status ? { status: status as never } : undefined,
      include: { client: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  updateAdminQuote(id: string, payload: UpdateQuoteAdminDto) {
    return this.prisma.quote.update({
      where: { id },
      data: {
        ...payload,
        status: payload.status as never,
      },
      include: { client: true },
    });
  }

  private async nextReference(): Promise<string> {
    const year = new Date().getUTCFullYear();
    const prefix = `DEM-${year}-`;
    const count = await this.prisma.quote.count({
      where: { reference: { startsWith: prefix } },
    });
    const sequence = String(count + 1).padStart(4, '0');
    return `${prefix}${sequence}`;
  }
}
