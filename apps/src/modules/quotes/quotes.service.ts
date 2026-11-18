import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { Prisma, User } from '../../generated/prisma/client';
import { GeoService } from '../../integrations/geo.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AvailabilityService } from '../calendar/availability.service';
import { type ChefIdentity, UsersService } from '../users/users.service';
import {
  ACTIVE_OFFER,
  AWAITING_CHEF,
  CLOSED,
  DUPLICATE_WINDOW_MS,
  MAX_DAYS_AHEAD,
  MAX_OPEN_REQUESTS,
  QuoteStatusKey,
  parisToday,
} from './domain/quote.rules';
import { CreateQuoteDto, UpdateQuoteAdminDto } from './dto/quote.dto';
import {
  AssignedChef,
  LoadedQuote,
  QUOTE_INCLUDE,
  QuoteView,
  Viewer,
  toQuoteView,
} from './quote.views';
import { QuotesMailer } from './quotes.mailer';

const notFound = () =>
  new NotFoundException({ code: 'QUOTE_NOT_FOUND', message: 'Request not found.' });

export type { ChefIdentity } from '../users/users.service';

/**
 * Custom requests: what a client asks for, who has it, and where it stands.
 *
 * A request is with one batch cooker at a time (`assignedChefUserId`), chosen by
 * the client or given by an admin. Offers, acceptance and the prestation they
 * lead to are `QuoteOffersService`.
 *
 * One access rule: a request that is not the caller's answers 404, so its
 * existence is never confirmed to a stranger.
 */
@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly mailer: QuotesMailer,
    private readonly audit: AuditService,
    private readonly availability: AvailabilityService,
    private readonly geo: GeoService,
  ) {}

  // ── Client ────────────────────────────────────────────────────────────────

  async createQuote(clerkUserId: string, dto: CreateQuoteDto): Promise<QuoteView> {
    const user = await this.me(clerkUserId);

    const desiredDate = new Date(`${dto.desiredDate}T00:00:00.000Z`);
    if (desiredDate.getTime() <= parisToday().getTime()) {
      throw new UnprocessableEntityException({
        code: 'DATE_TOO_SOON',
        message: 'desiredDate must be tomorrow at the earliest.',
      });
    }
    if (desiredDate.getTime() > parisToday().getTime() + MAX_DAYS_AHEAD * 86_400_000) {
      throw new UnprocessableEntityException({
        code: 'DATE_TOO_FAR',
        message: `desiredDate must be within ${MAX_DAYS_AHEAD} days.`,
      });
    }

    await this.geo.assertCommune(dto.addressPostalCode, dto.addressCity, 'addressCity');
    await this.geo.assertStreet(dto.addressLine, dto.addressPostalCode, 'addressLine');

    // Checked here and not in the browser: the form can be replayed by anything.
    const open = await this.prisma.quote.findMany({
      where: { clientId: user.id, status: { notIn: [...CLOSED] } },
      select: { title: true, desiredDate: true, createdAt: true },
    });
    const justSent = open.some(
      (quote) =>
        quote.title === dto.title &&
        quote.desiredDate?.getTime() === desiredDate.getTime() &&
        Date.now() - quote.createdAt.getTime() < DUPLICATE_WINDOW_MS,
    );
    if (justSent) {
      throw new ConflictException({
        code: 'DUPLICATE_REQUEST',
        message: 'This request was just sent.',
      });
    }
    if (open.length >= MAX_OPEN_REQUESTS) {
      throw new HttpException(
        {
          code: 'TOO_MANY_OPEN_REQUESTS',
          message: `A client can have ${MAX_OPEN_REQUESTS} requests open at once.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const chef = dto.chefProfileId
      ? await this.requestableChef(dto.chefProfileId, user.id)
      : null;
    // A day the batch cooker closed is never offered: no request for it either.
    if (chef) await this.availability.assertOpenOn(chef.id, desiredDate);

    const quote = await this.prisma.quote.create({
      data: {
        reference: await this.nextReference(),
        clientId: user.id,
        title: dto.title,
        occasion: dto.occasion || null,
        persons: dto.persons,
        mealsCount: dto.mealsCount,
        cuisine: dto.cuisine,
        diet: dto.diet ?? [],
        allergies: dto.allergies ?? [],
        brief: dto.brief,
        desiredDate,
        timeSlot: dto.timeSlot,
        addressLine: dto.addressLine,
        addressCity: dto.addressCity,
        addressPostalCode: dto.addressPostalCode,
        budgetCents: dto.budgetCents ?? null,
        assignedChefUserId: chef?.userId ?? null,
      },
      include: QUOTE_INCLUDE,
    });

    // Someone must know there is a request to answer: the batch cooker if one
    // was chosen, the team otherwise.
    if (chef) void this.notifyChef(quote, chef.userId);
    else {
      void this.mailer.needsChef({
        reference: quote.reference,
        title: quote.title,
        clientName: quote.client.fullName ?? quote.client.email,
        why: 'unassigned',
        quoteId: quote.id,
      });
    }
    return this.view(quote, 'client');
  }

  async listMine(clerkUserId: string): Promise<QuoteView[]> {
    const user = await this.me(clerkUserId);
    const quotes = await this.prisma.quote.findMany({
      where: { clientId: user.id },
      include: QUOTE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return this.views(quotes, 'client');
  }

  /** Reading a request is reading its offer: `sent` becomes `viewed`. */
  async getMine(clerkUserId: string, id: string): Promise<QuoteView> {
    const user = await this.me(clerkUserId);
    const quote = await this.loadForClient(user.id, id);
    const unread = quote.offers.find((offer) => offer.status === 'sent');
    if (!unread) return this.view(quote, 'client');

    await this.prisma.quoteOffer.updateMany({
      where: { id: unread.id, status: 'sent' },
      data: { status: 'viewed', viewedAt: new Date() },
    });
    return this.view(await this.loadForClient(user.id, id), 'client');
  }

  /**
   * The client withdraws the request. Kept, not deleted: the batch cooker who
   * was working on it and the admin still see what happened to it.
   */
  async cancelMine(clerkUserId: string, id: string): Promise<QuoteView> {
    const user = await this.me(clerkUserId);
    const quote = await this.loadForClient(user.id, id);
    // Already over, whoever ended it: a client's cancel never rewrites Lab's Food's close.
    if (quote.status === 'cancelled' || quote.status === 'closed') {
      return this.view(quote, 'client');
    }
    if (quote.status === 'accepted') {
      throw new ConflictException({
        code: 'QUOTE_ALREADY_ACCEPTED',
        message:
          'An accepted request has become a prestation: cancel the prestation instead.',
      });
    }
    await this.prisma.$transaction([
      this.prisma.quoteOffer.updateMany({
        where: { quoteId: id, status: { in: [...ACTIVE_OFFER] } },
        data: { status: 'withdrawn', decidedAt: new Date() },
      }),
      this.prisma.quote.update({ where: { id }, data: { status: 'cancelled' } }),
    ]);
    return this.view(await this.load(id), 'client');
  }

  // ── Batch cooker ──────────────────────────────────────────────────────────

  /**
   * The requests that are with this batch cooker, plus the ones they made an
   * offer on and that have since moved elsewhere: their own history.
   */
  async listForChef(clerkUserId: string): Promise<QuoteView[]> {
    const chef = await this.chefIdentity(clerkUserId);
    const quotes = await this.prisma.quote.findMany({
      where: this.visibleToChef(chef),
      include: QUOTE_INCLUDE,
      orderBy: { updatedAt: 'desc' },
    });
    return this.views(quotes, 'chef');
  }

  async getForChef(clerkUserId: string, id: string): Promise<QuoteView> {
    const chef = await this.chefIdentity(clerkUserId);
    return this.view(await this.loadForChef(chef, id), 'chef');
  }

  /**
   * The batch cooker turns the request down. It goes back to the team, who are
   * told; the client can wait for another batch cooker or withdraw.
   */
  async declineAsChef(
    clerkUserId: string,
    id: string,
    reason?: string,
  ): Promise<QuoteView> {
    const chef = await this.chefIdentity(clerkUserId);
    const quote = await this.loadAssignedTo(chef, id);
    this.assertAwaitingChef(quote);

    await this.prisma.quote.update({
      where: { id },
      data: {
        status: 'chef_declined',
        assignedChefUserId: null,
        chefDeclineReason: reason || null,
        chefDeclinedAt: new Date(),
      },
    });
    await this.audit.record({
      actorType: 'chef',
      actorUserId: chef.userId,
      action: 'quote.declined_by_chef',
      subjectType: 'quote',
      subjectId: id,
    });
    void this.mailer.needsChef({
      reference: quote.reference,
      title: quote.title,
      clientName: quote.client.fullName ?? quote.client.email,
      why: 'declined',
      declineReason: reason,
      quoteId: id,
    });
    // The request is no longer theirs to read: answer with what they just did.
    return {
      ...(await this.view(quote, 'chef')),
      status: 'chef_declined',
      chef: null,
      assignedChef: null,
      assignedChefUserId: null,
    };
  }

  // ── Admin ─────────────────────────────────────────────────────────────────

  async listAdmin(status?: string, filter?: string): Promise<QuoteView[]> {
    const where: Prisma.QuoteWhereInput = {
      ...(status ? { status: status as QuoteStatusKey } : {}),
      // Nobody to answer it: the client chose no batch cooker, or theirs said no.
      ...(filter === 'needs_chef'
        ? {
            assignedChefUserId: null,
            status: { in: ['submitted', 'in_review', 'chef_declined', 'declined'] },
          }
        : {}),
    };
    const quotes = await this.prisma.quote.findMany({
      where,
      include: QUOTE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return this.views(quotes, 'admin');
  }

  async getAdmin(id: string): Promise<QuoteView> {
    return this.view(await this.load(id), 'admin');
  }

  async updateAdmin(
    clerkUserId: string,
    id: string,
    dto: UpdateQuoteAdminDto,
    requestId?: string,
  ): Promise<QuoteView> {
    const quote = await this.load(id);
    const { assignedChefUserId, status, ...fields } = dto;
    const reassigning =
      assignedChefUserId !== undefined && assignedChefUserId !== quote.assignedChefUserId;

    if ((reassigning || status) && CLOSED.includes(quote.status)) {
      throw new ConflictException({
        code: 'QUOTE_CLOSED',
        message: `A request that is ${quote.status} cannot be reassigned or reopened.`,
      });
    }
    const closing = status === 'closed';
    if (closing && reassigning) {
      throw new UnprocessableEntityException({
        code: 'CLOSE_OR_ASSIGN',
        message: 'Close the request, or give it to a batch cooker: not both at once.',
      });
    }
    if (status && !closing && !reassigning && quote.status === 'quoted') {
      throw new ConflictException({
        code: 'OFFER_PENDING',
        message: 'An offer is waiting for the client: the status follows their answer.',
      });
    }
    if (reassigning && assignedChefUserId) {
      const chefProfileId = await this.assertAssignable(assignedChefUserId);
      // The new batch cooker's closed days hold too: their page promises no request.
      if (quote.desiredDate) {
        await this.availability.assertOpenOn(chefProfileId, quote.desiredDate);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      if (reassigning || closing) {
        // The previous batch cooker's open offer leaves with them; a closed request
        // keeps none open either.
        await tx.quoteOffer.updateMany({
          where: { quoteId: id, status: { in: [...ACTIVE_OFFER] } },
          data: { status: 'withdrawn', decidedAt: new Date() },
        });
      }
      await tx.quote.update({
        where: { id },
        data: {
          ...fields,
          ...(reassigning
            ? {
                assignedChefUserId,
                // A fresh start for whoever has it now.
                status: 'submitted',
                chefDeclineReason: null,
                chefDeclinedAt: null,
              }
            : status
              ? { status }
              : {}),
        },
      });
    });

    if (closing) {
      const admin = await this.me(clerkUserId);
      await this.audit.record({
        actorType: 'admin',
        actorUserId: admin.id,
        action: 'quote.closed',
        subjectType: 'quote',
        subjectId: id,
        metadata: { from: quote.status },
        requestId,
      });
      this.logger.log({ event: 'quote.closed', quoteId: id, from: quote.status });
      void this.notifyClosed(quote);
    }
    if (reassigning) {
      const admin = await this.me(clerkUserId);
      await this.audit.record({
        actorType: 'admin',
        actorUserId: admin.id,
        action: assignedChefUserId ? 'quote.assigned' : 'quote.unassigned',
        subjectType: 'quote',
        subjectId: id,
        metadata: { from: quote.assignedChefUserId, to: assignedChefUserId },
        requestId,
      });
      if (assignedChefUserId) void this.notifyChef(quote, assignedChefUserId);
    }
    return this.view(await this.load(id), 'admin');
  }

  // ── Shared with QuoteOffersService ────────────────────────────────────────

  async me(clerkUserId: string): Promise<User> {
    return (
      (await this.users.findByClerkId(clerkUserId)) ??
      this.users.ensurePersistedFromClerk(clerkUserId)
    );
  }

  /** The caller's batch cooker page, which must be verified to work on requests. */
  chefIdentity(clerkUserId: string): Promise<ChefIdentity> {
    return this.users.chefIdentity(clerkUserId);
  }

  async load(id: string): Promise<LoadedQuote> {
    const quote = await this.prisma.quote.findUnique({
      where: { id },
      include: QUOTE_INCLUDE,
    });
    if (!quote) throw notFound();
    return quote;
  }

  async loadForClient(userId: string, id: string): Promise<LoadedQuote> {
    const quote = await this.prisma.quote.findFirst({
      where: { id, clientId: userId },
      include: QUOTE_INCLUDE,
    });
    if (!quote) throw notFound();
    return quote;
  }

  /** A request this batch cooker may read: theirs now, or one they offered on. */
  async loadForChef(chef: ChefIdentity, id: string): Promise<LoadedQuote> {
    const quote = await this.prisma.quote.findFirst({
      where: { AND: [{ id }, this.visibleToChef(chef)] },
      include: QUOTE_INCLUDE,
    });
    if (!quote) throw notFound();
    return quote;
  }

  /** A request this batch cooker may act on: it is with them right now. */
  async loadAssignedTo(chef: ChefIdentity, id: string): Promise<LoadedQuote> {
    const quote = await this.prisma.quote.findFirst({
      where: { id, assignedChefUserId: chef.userId },
      include: QUOTE_INCLUDE,
    });
    if (!quote) throw notFound();
    return quote;
  }

  assertAwaitingChef(quote: LoadedQuote): void {
    if (quote.status === 'quoted') {
      throw new ConflictException({
        code: 'OFFER_ALREADY_ACTIVE',
        message: 'An offer is already waiting for the client. Withdraw it first.',
      });
    }
    if (!AWAITING_CHEF.includes(quote.status)) {
      throw new ConflictException({
        code: 'QUOTE_CLOSED',
        message: `A request that is ${quote.status} is no longer open to an answer.`,
      });
    }
  }

  async view(quote: LoadedQuote, viewer: Viewer): Promise<QuoteView> {
    const [view] = await this.views([quote], viewer);
    return view;
  }

  /**
   * `assignedChefUserId` is an account id with no relation behind it: the batch
   * cookers of a page are read in one extra query.
   */
  async views(quotes: LoadedQuote[], viewer: Viewer): Promise<QuoteView[]> {
    const userIds = [
      ...new Set(quotes.map((q) => q.assignedChefUserId).filter((id) => id !== null)),
    ];
    const profiles = userIds.length
      ? await this.prisma.chefProfile.findMany({
          where: { userId: { in: userIds } },
          select: {
            id: true,
            userId: true,
            displayName: true,
            city: true,
            user: { select: { avatarUrl: true } },
          },
        })
      : [];
    const byUserId = new Map<string, AssignedChef>(
      profiles.map((p) => [
        p.userId,
        {
          userId: p.userId,
          chefProfileId: p.id,
          displayName: p.displayName,
          city: p.city,
          avatarUrl: p.user.avatarUrl,
        },
      ]),
    );
    return quotes.map((quote) =>
      toQuoteView(
        quote,
        quote.assignedChefUserId
          ? (byUserId.get(quote.assignedChefUserId) ?? null)
          : null,
        viewer,
      ),
    );
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private visibleToChef(chef: ChefIdentity): Prisma.QuoteWhereInput {
    return {
      OR: [
        { assignedChefUserId: chef.userId },
        { offers: { some: { chefProfileId: chef.chefProfileId } } },
      ],
    };
  }

  /** The batch cooker a client may address a request to. */
  private async requestableChef(chefProfileId: string, clientUserId: string) {
    const chef = await this.prisma.chefProfile.findFirst({
      where: { id: chefProfileId, isVerified: true, user: { deletedAt: null } },
      select: { id: true, userId: true },
    });
    if (!chef) {
      throw new UnprocessableEntityException({
        code: 'CHEF_NOT_AVAILABLE',
        message: 'chefProfileId is not a verified batch cooker.',
      });
    }
    if (chef.userId === clientUserId) {
      throw new UnprocessableEntityException({
        code: 'SAME_PERSON',
        message: 'A batch cooker cannot send a request to themselves.',
      });
    }
    return chef;
  }

  /**
   * Only a batch cooker the platform vouches for can be given a client's request.
   * Offline is fine: taking a custom request does not need an open storefront.
   */
  private async assertAssignable(userId: string): Promise<string> {
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
    return chef.id;
  }

  private async notifyChef(quote: LoadedQuote, chefUserId: string): Promise<void> {
    try {
      const chef = await this.prisma.user.findUnique({
        where: { id: chefUserId },
        select: { email: true, fullName: true },
      });
      if (!chef) return;
      await this.mailer.requestForChef({
        chef,
        reference: quote.reference,
        title: quote.title,
        persons: quote.persons,
        city: quote.addressCity,
        desiredDate: quote.desiredDate,
        timeSlot: quote.timeSlot,
      });
    } catch (error) {
      this.logger.error(
        `Request email failed for ${quote.reference}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** Best-effort: a failed email never reopens the request. */
  private async notifyClosed(quote: LoadedQuote): Promise<void> {
    try {
      const chef = quote.assignedChefUserId
        ? await this.prisma.user.findUnique({
            where: { id: quote.assignedChefUserId },
            select: { email: true, fullName: true },
          })
        : null;
      const mail = { reference: quote.reference, title: quote.title };
      await Promise.all([
        this.mailer.closed({ ...mail, to: quote.client, forChef: false }),
        chef && this.mailer.closed({ ...mail, to: chef, forChef: true }),
      ]);
    } catch (error) {
      this.logger.error(
        { event: 'quote.closed_email_failed', quoteId: quote.id },
        error instanceof Error ? error.stack : String(error),
      );
    }
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
