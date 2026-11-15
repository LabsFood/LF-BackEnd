import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { expressDecisionBlock } from './domain/quote.rules';
import { QuotesService } from './quotes.service';

const notFound = () =>
  new NotFoundException({
    code: 'EXPRESS_DISH_NOT_FOUND',
    message: 'No express dish of yours with this id.',
  });

const EXPRESS_SELECT = {
  id: true,
  name: true,
  description: true,
  allergens: true,
  createdAt: true,
  expressDecision: true,
  expressQuote: { select: { id: true, reference: true, title: true } },
  offerDishes: { select: { offer: { select: { status: true } } } },
  bookingMeals: {
    select: {
      booking: { select: { id: true, reference: true, status: true, startsAt: true } },
    },
  },
} as const;

type ExpressRow = {
  id: string;
  name: string;
  description: string | null;
  allergens: string[];
  createdAt: Date;
  expressDecision: string | null;
  expressQuote: { id: string; reference: string; title: string } | null;
  offerDishes: { offer: { status: string } }[];
  bookingMeals: {
    booking: { id: string; reference: string | null; status: string; startsAt: Date };
  }[];
};

const usesOf = (row: ExpressRow) => ({
  offers: row.offerDishes.map((d) => d.offer.status),
  bookings: row.bookingMeals.map((m) => m.booking.status),
});

/**
 * Express dishes (« plats express », decision of 15/11): written in a few words for
 * one custom request, out of the batch cooker's catalogue. Once nothing waits on
 * one (no offer the client can still accept, no prestation still to cook), the
 * batch cooker keeps it (an ordinary draft, to complete before publishing) or drops
 * it (archived; the prestations it was cooked in keep it).
 */
@Injectable()
export class ExpressDishesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotes: QuotesService,
    private readonly audit: AuditService,
  ) {}

  /** The batch cooker's express dishes still to decide, newest first. */
  async listMine(clerkUserId: string) {
    const chef = await this.quotes.chefIdentity(clerkUserId);
    const rows = (await this.prisma.meal.findMany({
      where: {
        chefProfileId: chef.chefProfileId,
        expressQuoteId: { not: null },
        expressDecision: null,
      },
      orderBy: { createdAt: 'desc' },
      select: EXPRESS_SELECT,
    })) as ExpressRow[];
    return rows.map((row) => {
      const prestation =
        [...row.bookingMeals]
          .map((m) => m.booking)
          .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0] ?? null;
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        allergens: row.allergens,
        createdAt: row.createdAt,
        request: row.expressQuote,
        prestation,
        /** Null: the batch cooker may decide now. Otherwise, what it waits for. */
        decisionBlockedBy: expressDecisionBlock(usesOf(row)),
      };
    });
  }

  async decide(clerkUserId: string, id: string, decision: 'kept' | 'dropped') {
    const chef = await this.quotes.chefIdentity(clerkUserId);
    const row = (await this.prisma.meal.findFirst({
      where: { id, chefProfileId: chef.chefProfileId, expressQuoteId: { not: null } },
      select: EXPRESS_SELECT,
    })) as ExpressRow | null;
    if (!row) throw notFound();
    if (row.expressDecision !== null) {
      if (row.expressDecision === decision) return { id, decision };
      throw new ConflictException({
        code: 'EXPRESS_ALREADY_DECIDED',
        message: `This dish was already ${row.expressDecision === 'kept' ? 'kept' : 'dropped'}.`,
      });
    }
    const blocked = expressDecisionBlock(usesOf(row));
    if (blocked) {
      throw new ConflictException({
        code: 'EXPRESS_DECISION_TOO_SOON',
        message:
          blocked === 'OFFER_PENDING'
            ? 'An offer with this dish is still waiting for the client.'
            : 'A prestation with this dish is still to be cooked.',
        reason: blocked,
      });
    }
    const now = new Date();
    const { count } = await this.prisma.meal.updateMany({
      // Only while undecided: two taps never decide twice.
      where: { id, chefProfileId: chef.chefProfileId, expressDecision: null },
      data:
        decision === 'kept'
          ? { expressDecision: 'kept', expressDecidedAt: now }
          : { expressDecision: 'dropped', expressDecidedAt: now, status: 'archived' },
    });
    if (count === 0) throw notFound();
    await this.audit.record({
      actorType: 'chef',
      actorUserId: chef.userId,
      action: decision === 'kept' ? 'dish.express_kept' : 'dish.express_dropped',
      subjectType: 'meal',
      subjectId: id,
      metadata: { quoteId: row.expressQuote?.id ?? null },
    });
    return { id, decision };
  }
}
