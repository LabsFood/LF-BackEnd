import { Injectable, NotFoundException } from '@nestjs/common';

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
    const user = await this.users.upsertFromClerk({ clerkUserId });
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
    const user = await this.users.upsertFromClerk({ clerkUserId });
    return this.prisma.quote.findMany({
      where: { clientId: user.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  async acceptMyQuote(clerkUserId: string, id: string) {
    const user = await this.users.upsertFromClerk({ clerkUserId });
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
