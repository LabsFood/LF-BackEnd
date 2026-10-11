import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
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

  async listMyQuotes(clerkUserId: string) {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    return this.prisma.quote.findMany({
      where: { clientId: user.id },
      orderBy: { createdAt: 'desc' },
    });
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

  async listAdminQuotes(status?: string) {
    const quotes = await this.prisma.quote.findMany({
      where: status ? { status: status as never } : undefined,
      include: { client: true },
      orderBy: { createdAt: 'desc' },
    });
    return this.withAssignedChef(quotes);
  }

  async updateAdminQuote(id: string, payload: UpdateQuoteAdminDto) {
    if (payload.assignedChefUserId) {
      await this.assertAssignable(payload.assignedChefUserId);
    }
    const quote = await this.prisma.quote.update({
      where: { id },
      data: {
        ...payload,
        status: payload.status as never,
      },
      include: { client: true },
    });
    const [withChef] = await this.withAssignedChef([quote]);
    return withChef;
  }

  /**
   * Only a batch cooker the platform vouches for can be given a client's request.
   * Offline is fine: taking a custom request does not need an open storefront.
   */
  private async assertAssignable(userId: string): Promise<void> {
    const chef = await this.prisma.chefProfile.findFirst({
      where: { userId, isVerified: true, user: { deletedAt: null } },
      select: { id: true },
    });
    if (!chef) {
      throw new UnprocessableEntityException({
        code: 'CHEF_NOT_ASSIGNABLE',
        message: 'assignedChefUserId is not the account of a verified batch cooker.',
      });
    }
  }

  /**
   * Adds who `assignedChefUserId` is. The column holds an account id with no
   * relation behind it, so the names are read in one extra query for the page.
   */
  private async withAssignedChef<T extends { assignedChefUserId: string | null }>(
    quotes: T[],
  ) {
    const userIds = [
      ...new Set(quotes.map((q) => q.assignedChefUserId).filter((id) => id !== null)),
    ];
    const chefs = userIds.length
      ? await this.prisma.chefProfile.findMany({
          where: { userId: { in: userIds } },
          select: { id: true, userId: true, displayName: true },
        })
      : [];
    const byUserId = new Map(chefs.map((chef) => [chef.userId, chef]));

    return quotes.map((quote) => {
      const chef = quote.assignedChefUserId
        ? byUserId.get(quote.assignedChefUserId)
        : undefined;
      return {
        ...quote,
        assignedChef: chef
          ? { userId: chef.userId, chefProfileId: chef.id, displayName: chef.displayName }
          : null,
      };
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
