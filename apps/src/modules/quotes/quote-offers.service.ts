import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SentryCron } from '@sentry/nestjs';

import { AuditService } from '../../common/audit/audit.service';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MessagingService } from '../messaging/services/messaging.service';
import { findCommissionBlock } from '../payments/commission-standing';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import {
  ACTIVE_OFFER,
  MAX_DAYS_AHEAD,
  TimeSlot,
  parisToday,
  priceOffer,
  slotWindow,
} from './domain/quote.rules';
import { CreateQuoteOfferDto } from './dto/quote.dto';
import { LoadedQuote, QuoteView } from './quote.views';
import { QuotesMailer } from './quotes.mailer';
import { ChefIdentity, QuotesService } from './quotes.service';
import { contractConsentRequired } from '../bookings/domain/contract.errors';
import {
  acceptedConsents,
  consentsAuditMetadata,
  contractGaps,
  type ConsentsInput,
} from '../bookings/domain/contract.rules';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_VALIDITY_DAYS = 7;

/** The line a custom prestation hangs on in a batch cooker's catalogue. */
export const CUSTOM_OFFER_NAME = 'Prestation sur-mesure';

const offerNotFound = () =>
  new NotFoundException({ code: 'OFFER_NOT_FOUND', message: 'Offer not found.' });

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/**
 * Offers on a custom request, and what an accepted one becomes.
 *
 * The batch cooker types a net; the client price is computed once with the
 * commission of that day and stored. The client answers the one active offer.
 * Accepting it is the agreement on the price: that, and nothing earlier, creates
 * the prestation, opens the conversation and tells both sides.
 */
@Injectable()
export class QuoteOffersService {
  private readonly logger = new Logger(QuoteOffersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quotes: QuotesService,
    private readonly settings: PlatformSettingsService,
    private readonly messaging: MessagingService,
    private readonly mailer: QuotesMailer,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  // ── Batch cooker ──────────────────────────────────────────────────────────

  async createAsChef(
    clerkUserId: string,
    quoteId: string,
    dto: CreateQuoteOfferDto,
  ): Promise<QuoteView> {
    const chef = await this.quotes.chefIdentity(clerkUserId);
    const quote = await this.quotes.loadAssignedTo(chef, quoteId);
    await this.create(quote, chef, dto, { actorType: 'chef', actorUserId: chef.userId });
    return this.quotes.view(await this.quotes.load(quoteId), 'chef');
  }

  /** The batch cooker takes their offer back before the client has answered. */
  async withdrawAsChef(
    clerkUserId: string,
    quoteId: string,
    offerId: string,
  ): Promise<QuoteView> {
    const chef = await this.quotes.chefIdentity(clerkUserId);
    await this.quotes.loadForChef(chef, quoteId);
    const { count } = await this.prisma.quoteOffer.updateMany({
      where: {
        id: offerId,
        quoteId,
        chefProfileId: chef.chefProfileId,
        status: { in: [...ACTIVE_OFFER] },
      },
      data: { status: 'withdrawn', decidedAt: new Date() },
    });
    if (count === 0) throw offerNotFound();
    // Back to the batch cooker: they may send another one.
    await this.prisma.quote.updateMany({
      where: { id: quoteId, status: 'quoted' },
      data: { status: 'submitted' },
    });
    return this.quotes.view(await this.quotes.load(quoteId), 'chef');
  }

  // ── Admin ─────────────────────────────────────────────────────────────────

  /**
   * An admin prices the request in the name of the batch cooker it is with, for
   * the day the batch cooker cannot do it themselves. Same offer, same rules.
   */
  async createAsAdmin(
    clerkUserId: string,
    quoteId: string,
    dto: CreateQuoteOfferDto,
    requestId?: string,
  ): Promise<QuoteView> {
    const admin = await this.quotes.me(clerkUserId);
    const quote = await this.quotes.load(quoteId);
    const profile = quote.assignedChefUserId
      ? await this.prisma.chefProfile.findUnique({
          where: { userId: quote.assignedChefUserId },
          select: { id: true, userId: true },
        })
      : null;
    if (!profile) {
      throw new ConflictException({
        code: 'QUOTE_HAS_NO_CHEF',
        message: 'Assign a batch cooker before pricing: the offer is made in their name.',
      });
    }
    await this.create(quote, { userId: profile.userId, chefProfileId: profile.id }, dto, {
      actorType: 'admin',
      actorUserId: admin.id,
      requestId,
    });
    return this.quotes.view(await this.quotes.load(quoteId), 'admin');
  }

  // ── Client ────────────────────────────────────────────────────────────────

  /**
   * The client accepts: the offer is settled and the prestation exists, in one
   * transaction. The conversation and the emails follow, and never undo it.
   */
  async accept(
    clerkUserId: string,
    quoteId: string,
    offerId?: string,
    consentsInput?: ConsentsInput,
  ): Promise<QuoteView> {
    const user = await this.quotes.me(clerkUserId);
    const quote = await this.quotes.loadForClient(user.id, quoteId);
    const offer = this.activeOffer(quote, offerId);
    const now = new Date();

    if (offer.validUntil.getTime() < now.getTime()) {
      await this.expire([offer.id]);
      throw new ConflictException({
        code: 'OFFER_EXPIRED',
        message: 'This offer has expired. The batch cooker can send a new one.',
      });
    }

    const day = offer.proposedDate ?? quote.desiredDate;
    const slot = (offer.proposedTimeSlot ?? quote.timeSlot) as TimeSlot | null;
    if (!day || !slot) {
      throw new ConflictException({
        code: 'QUOTE_HAS_NO_DATE',
        message: 'This request has no date: it cannot become a prestation.',
      });
    }
    const window = slotWindow(day, slot);
    // CGV art. 5.1: accepting concludes the contract now, so the boxes come with it.
    // A custom prestation has no shopping by the batch cooker: no débours mandate.
    const consents = acceptedConsents(consentsInput, now);
    const missing = contractGaps(consents, {
      chefShops: false,
      startsAt: window.startsAt,
      latestConclusion: now,
      bookedAt: now,
    });
    if (missing.length) throw contractConsentRequired(missing, 'booking');
    const address = [
      quote.addressLine,
      [quote.addressPostalCode, quote.addressCity].filter(Boolean).join(' '),
    ]
      .filter(Boolean)
      .join(', ');

    let bookingId: string;
    try {
      bookingId = await this.prisma.$transaction(async (tx) => {
        // Settles the offer only if nobody else has: two taps on "accept", or an
        // acceptance racing the expiry job, must not create two prestations.
        const settled = await tx.quoteOffer.updateMany({
          where: { id: offer.id, status: { in: [...ACTIVE_OFFER] } },
          data: { status: 'accepted', decidedAt: now },
        });
        if (settled.count === 0) {
          throw new ConflictException({
            code: 'OFFER_NOT_ACTIVE',
            message: 'This offer is no longer open.',
          });
        }
        const line =
          (await tx.serviceOffer.findFirst({
            where: { chefProfileId: offer.chefProfileId, name: CUSTOM_OFFER_NAME },
            select: { id: true },
          })) ??
          (await tx.serviceOffer.create({
            data: {
              chefProfileId: offer.chefProfileId,
              name: CUSTOM_OFFER_NAME,
              description: 'Prestations issues d’une demande sur-mesure.',
              durationMinutes: 240,
              priceCents: 0,
              // Not something to book from the storefront: each one is priced.
              isActive: false,
            },
            select: { id: true },
          }));
        const booking = await tx.booking.create({
          data: {
            // One prestation per request: unique by construction.
            reference: quote.reference.replace(/^DEM-/, 'LF-SM-'),
            clientId: quote.clientId,
            chefProfileId: offer.chefProfileId,
            serviceOfferId: line.id,
            bookingDate: day,
            timeSlot: window.label,
            persons: quote.persons,
            startsAt: window.startsAt,
            endsAt: window.endsAt,
            status: 'confirmed',
            concludedAt: now,
            ...consents,
            priceCents: offer.clientPriceCents,
            amountTtc: offer.clientPriceCents,
            amountAfterTax: offer.afterTaxCreditCents,
            addressLine: address.slice(0, 255) || null,
            addressCity: quote.addressCity,
            addressPostalCode: quote.addressPostalCode,
            notes: quote.brief,
          },
          select: { id: true },
        });
        await tx.quote.update({
          where: { id: quote.id },
          data: { status: 'accepted', bookingId: booking.id },
        });
        return booking.id;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      throw new ConflictException({
        code: 'OFFER_NOT_ACTIVE',
        message: 'This request already became a prestation.',
      });
    }

    await this.audit.record({
      actorType: 'client',
      actorUserId: user.id,
      action: 'quote.offer_accepted',
      subjectType: 'quote',
      subjectId: quote.id,
      metadata: { offerId: offer.id, bookingId },
    });
    if (consents.contractVersion) {
      await this.audit.record({
        actorType: 'client',
        actorUserId: user.id,
        action: 'booking.consents',
        subjectType: 'booking',
        subjectId: bookingId,
        metadata: consentsAuditMetadata(consents),
      });
    }
    void this.afterAcceptance(quote, offer, {
      bookingId,
      day,
      slot,
      address,
      // The contract email (bookings-contract-mail) is then the client's confirmation.
      contract: consents.contractVersion !== null,
    });
    return this.quotes.view(await this.quotes.load(quoteId), 'client');
  }

  async decline(
    clerkUserId: string,
    quoteId: string,
    offerId: string,
    reason?: string,
  ): Promise<QuoteView> {
    const user = await this.quotes.me(clerkUserId);
    const quote = await this.quotes.loadForClient(user.id, quoteId);
    const offer = this.activeOffer(quote, offerId);

    const { count } = await this.prisma.quoteOffer.updateMany({
      where: { id: offer.id, status: { in: [...ACTIVE_OFFER] } },
      data: { status: 'declined', decidedAt: new Date(), declineReason: reason || null },
    });
    if (count === 0) throw offerNotFound();
    await this.prisma.quote.updateMany({
      where: { id: quoteId, status: 'quoted' },
      data: { status: 'declined' },
    });
    void this.notifyDeclined(quote, offer.chefProfileId, reason ?? null);
    return this.quotes.view(await this.quotes.load(quoteId), 'client');
  }

  // ── Expiry ────────────────────────────────────────────────────────────────

  /**
   * An offer nobody answered in time stops being one. Safe on several replicas:
   * each update only touches rows still in the state it expects.
   */
  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'quote-offers-expiry' })
  @SentryCron('quote-offers-expiry', {
    checkinMargin: 5,
    maxRuntime: 5,
    failureIssueThreshold: 3,
  })
  async expireDue(): Promise<number> {
    try {
      const due = await this.prisma.quoteOffer.findMany({
        where: { status: { in: [...ACTIVE_OFFER] }, validUntil: { lt: new Date() } },
        select: { id: true },
      });
      if (due.length === 0) return 0;
      const expired = await this.expire(due.map((offer) => offer.id));
      if (expired > 0) this.logger.log(`Expired ${expired} offer(s).`);
      return expired;
    } catch (error) {
      this.logger.error(
        'Offer expiry job failed',
        error instanceof Error ? error.stack : String(error),
      );
      return 0;
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async create(
    quote: LoadedQuote,
    chef: ChefIdentity,
    dto: CreateQuoteOfferDto,
    actor: { actorType: 'chef' | 'admin'; actorUserId: string; requestId?: string },
  ): Promise<void> {
    this.quotes.assertAwaitingChef(quote);

    // A commission Lab's Food could not collect stops a batch cooker taking on new
    // work. An offer is where new work starts here, so this is where it stops.
    const block = await findCommissionBlock(
      this.prisma,
      chef.chefProfileId,
      this.config.get<number>('payments.commissionDebitMaxAttempts', 3),
    );
    if (block) {
      throw new ConflictException({ code: 'COMMISSION_UNPAID', message: block.message });
    }

    const proposedDate = dto.proposedDate
      ? new Date(`${dto.proposedDate}T00:00:00.000Z`)
      : null;
    if (proposedDate && proposedDate.getTime() <= parisToday().getTime()) {
      throw new UnprocessableEntityException({
        code: 'DATE_TOO_SOON',
        message: 'proposedDate must be tomorrow at the earliest.',
      });
    }
    if (
      proposedDate &&
      proposedDate.getTime() > parisToday().getTime() + MAX_DAYS_AHEAD * 86_400_000
    ) {
      throw new UnprocessableEntityException({
        code: 'DATE_TOO_FAR',
        message: `proposedDate must be within ${MAX_DAYS_AHEAD} days.`,
      });
    }

    const commissionBps = await this.settings.commissionBps();
    const price = priceOffer(dto.netCents, commissionBps);
    const validUntil = new Date(
      Date.now() + (dto.validityDays ?? DEFAULT_VALIDITY_DAYS) * DAY_MS,
    );

    try {
      await this.prisma.$transaction([
        this.prisma.quoteOffer.create({
          data: {
            quoteId: quote.id,
            chefProfileId: chef.chefProfileId,
            netCents: dto.netCents,
            commissionBps,
            clientPriceCents: price.clientPriceCents,
            afterTaxCreditCents: price.afterTaxCreditCents,
            proposedDate,
            proposedTimeSlot: dto.proposedTimeSlot ?? null,
            conditions: dto.conditions || null,
            validUntil,
          },
        }),
        this.prisma.quote.update({
          where: { id: quote.id },
          data: { status: 'quoted' },
        }),
      ]);
    } catch (error) {
      // The partial unique index: another offer went in between the check and the write.
      if (!isUniqueViolation(error)) throw error;
      throw new ConflictException({
        code: 'OFFER_ALREADY_ACTIVE',
        message: 'An offer is already waiting for the client. Withdraw it first.',
      });
    }

    await this.audit.record({
      actorType: actor.actorType,
      actorUserId: actor.actorUserId,
      action: 'quote.offer_sent',
      subjectType: 'quote',
      subjectId: quote.id,
      metadata: { netCents: dto.netCents, commissionBps, ...price },
      requestId: actor.requestId,
    });
    void this.notifyOffer(quote, chef.chefProfileId, price, validUntil);
  }

  /** The offer the client is answering: the active one, and the one they named. */
  private activeOffer(quote: LoadedQuote, offerId?: string) {
    const active = quote.offers.find((offer) =>
      (ACTIVE_OFFER as readonly string[]).includes(offer.status),
    );
    if (!active || (offerId && active.id !== offerId)) {
      // Named an offer that exists but is settled: say so rather than "not found".
      if (offerId && quote.offers.some((offer) => offer.id === offerId)) {
        throw new ConflictException({
          code: 'OFFER_NOT_ACTIVE',
          message: 'This offer is no longer open.',
        });
      }
      throw offerNotFound();
    }
    return active;
  }

  /** Expires the given offers, and hands their requests back to the batch cooker. */
  private async expire(offerIds: string[]): Promise<number> {
    const { count } = await this.prisma.quoteOffer.updateMany({
      where: { id: { in: offerIds }, status: { in: [...ACTIVE_OFFER] } },
      data: { status: 'expired', decidedAt: new Date() },
    });
    await this.prisma.quote.updateMany({
      where: {
        status: 'quoted',
        offers: { none: { status: { in: [...ACTIVE_OFFER] } } },
      },
      data: { status: 'submitted' },
    });
    return count;
  }

  /** Conversation and emails. Best-effort: the prestation already exists. */
  private async afterAcceptance(
    quote: LoadedQuote,
    offer: LoadedQuote['offers'][number],
    ctx: {
      bookingId: string;
      day: Date;
      slot: TimeSlot;
      address: string;
      contract: boolean;
    },
  ): Promise<void> {
    try {
      await this.messaging.ensurePair(quote.clientId, offer.chefProfileId);
    } catch (error) {
      this.logger.error(
        `Conversation not opened for ${quote.reference}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
    try {
      const [chef, booking] = await Promise.all([
        this.prisma.chefProfile.findUnique({
          where: { id: offer.chefProfileId },
          select: {
            displayName: true,
            user: { select: { email: true, fullName: true } },
          },
        }),
        this.prisma.booking.findUnique({
          where: { id: ctx.bookingId },
          select: { reference: true },
        }),
      ]);
      if (!chef) return;
      await this.mailer.bookingConfirmed({
        client: quote.client,
        chef: { ...chef.user, displayName: chef.displayName },
        bookingReference: booking?.reference ?? null,
        title: quote.title,
        date: ctx.day,
        timeSlot: ctx.slot,
        address: ctx.address,
        persons: quote.persons,
        clientPriceCents: offer.clientPriceCents,
        afterTaxCreditCents: offer.afterTaxCreditCents,
        netCents: offer.netCents,
        conditions: offer.conditions,
        clientCopy: !ctx.contract,
      });
    } catch (error) {
      this.logger.error(
        `Confirmation emails failed for ${quote.reference}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async notifyOffer(
    quote: LoadedQuote,
    chefProfileId: string,
    price: { clientPriceCents: number; afterTaxCreditCents: number },
    validUntil: Date,
  ): Promise<void> {
    try {
      const chef = await this.prisma.chefProfile.findUnique({
        where: { id: chefProfileId },
        select: { displayName: true },
      });
      await this.mailer.offerForClient({
        client: quote.client,
        chefName: chef?.displayName ?? 'Votre batch cooker',
        title: quote.title,
        ...price,
        validUntil,
      });
    } catch (error) {
      this.logger.error(
        `Offer email failed for ${quote.reference}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async notifyDeclined(
    quote: LoadedQuote,
    chefProfileId: string,
    reason: string | null,
  ): Promise<void> {
    try {
      const chef = await this.prisma.chefProfile.findUnique({
        where: { id: chefProfileId },
        select: { user: { select: { email: true, fullName: true } } },
      });
      if (!chef) return;
      await this.mailer.offerDeclinedForChef({
        chef: chef.user,
        title: quote.title,
        reason,
      });
    } catch (error) {
      this.logger.error(
        `Decline email failed for ${quote.reference}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
