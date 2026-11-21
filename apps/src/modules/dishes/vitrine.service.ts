import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import {
  BookingStatus,
  ChefDocumentStatus,
  ChefDocumentType,
  ChefProfile,
  MealStatus,
} from '../../generated/prisma/client';
import { buildPaginationMeta, resolvePageBounds } from '../../common/dto/pagination.dto';
import { GeoService } from '../../integrations/geo.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AvailabilityService } from '../calendar/availability.service';
import { cesuAccepted } from '../payments/chef-cesu-info';
import { afterTaxCredit } from '../quotes/domain/quote.rules';
import { MENU_DISHES, MenuWithDishes } from './chef-content.service';
import { toPublicDish } from './dishes.views';
import {
  coveredDiets,
  coversArea,
  coversCommune,
  InterventionZone,
  parisDay,
  parisMidnight,
  vitrineOrder,
  weekOf,
} from './domain/vitrine.rules';
import { validationFailed } from './domain/content.errors';
import {
  ChefShowcaseQueryDto,
  CoveringChefsQueryDto,
  WeekMenusQueryDto,
} from './dto/vitrine.dto';
import { CHEF_LEGAL_SELECT, publicChefLegalIdentity } from '../users/chef-legal.views';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SHOWCASE_WEEKS = 26;

/** Public badges, derived from documents an admin validated (§5.2). */
const BADGE: Partial<Record<ChefDocumentType, string>> = {
  haccp: 'haccp',
  rc_pro: 'insured',
  ddpp: 'ddpp-declared',
};

/** Only these reach the public site (§5.1): approved, and online. */
const LISTED_CHEF = { isVerified: true, isActive: true };

/** What the public site reads of a chef profile, and nothing more. */
const PUBLIC_CHEF_FIELDS = {
  id: true,
  displayName: true,
  city: true,
  bio: true,
  interventionZones: true,
  languages: true,
  // The profile photo is the account's; nothing else of the account is read.
  user: { select: { avatarUrl: true } },
  sapProfile: { select: { acceptsCesu: true, crcesuNan: true } },
  sepaMandate: { select: { status: true } },
} as const;

type PublicChef = Pick<
  ChefProfile,
  'id' | 'displayName' | 'city' | 'bio' | 'interventionZones' | 'languages'
> & {
  user: { avatarUrl: string | null };
  sapProfile: { acceptsCesu: boolean; crcesuNan: string | null } | null;
  sepaMandate: { status: string } | null;
};

/** An offer alone, as booked: the shopping fee is billed with it when the chef shops. */
const offerClientCents = (offer: {
  priceCents: number;
  shoppingIncluded: boolean;
  shoppingFeeCents: number;
}) => offer.priceCents + (offer.shoppingIncluded ? offer.shoppingFeeCents : 0);

/** A menu's published dishes: a draft or suspended one never shows (§3.4). */
const publishedDishes = (menu: MenuWithDishes) =>
  menu.dishes.map((d) => d.meal).filter((meal) => meal.status === MealStatus.published);

/**
 * The public site (FLOW-02 §5): the weekly page that lists cooks rather than
 * dishes, and each cook's page. Nothing here needs a token, so nothing here ever
 * returns a recipe, a draft, a suspended dish, or a chef who is not listed.
 */
@Injectable()
export class VitrineService {
  private readonly logger = new Logger(VitrineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly geo: GeoService,
  ) {}

  /**
   * The chefs a client can address a custom request to, for the town of the
   * prestation: approved, online, and covering it. The commune is checked against
   * the official base first, which gives its INSEE code and region. Names only, so
   * the form's list stays light.
   *
   * ponytail: filters every listed chef in memory, like `week`. Move the zone match
   * into SQL when there are thousands of chefs.
   */
  async covering(query: CoveringChefsQueryDto) {
    const commune = await this.geo.assertCommune(query.postalCode, query.city, 'city');
    if (!commune) return { data: [] };

    const chefs = await this.prisma.chefProfile.findMany({
      where: LISTED_CHEF,
      select: { id: true, displayName: true, city: true, interventionZones: true },
    });
    const data = chefs
      .filter((chef) => coversCommune(chef.interventionZones, commune))
      .map(({ id, displayName, city }) => ({ id, displayName, city }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr'));

    this.logger.debug({
      event: 'vitrine.covering_listed',
      listed: chefs.length,
      covering: data.length,
    });
    return { data };
  }

  /**
   * §5.1. Chefs who cover the area and are not fully booked, then filtered by
   * diets, shopping and text; those with a menu this week first, each group in
   * the month's rotation (PRD). Paginated after ordering, so pages are stable.
   *
   * ponytail: filters and orders every listed chef in memory. Fine for hundreds of
   * chefs; move the area and diet filters into SQL when the list grows past that.
   */
  async week(query: WeekMenusQueryDto) {
    const week = weekOf(query.week ?? parisDay(new Date()));
    // The showcase is keyed by a DATE; slots are instants, bounded by Paris midnights.
    const start = toDate(week.start);
    const slotsFrom = parisMidnight(week.start);
    const slotsTo = parisMidnight(toDay(new Date(start.getTime() + 7 * DAY_MS)));

    const chefs = (
      await this.prisma.chefProfile.findMany({
        where: LISTED_CHEF,
        select: PUBLIC_CHEF_FIELDS,
      })
    ).filter((chef) =>
      coversArea(zonesOf(chef), { region: query.region, city: query.city }),
    );
    const ids = chefs.map((chef) => chef.id);

    const started = Date.now();
    const [slotsLeft, showcase, dishes, extras] = await Promise.all([
      // From the agenda: whole free sessions this week (FLOW-02 §5.1).
      this.availability.slotsLeftFor(ids, slotsFrom, slotsTo),
      this.prisma.chefShowcaseWeek.findMany({
        where: { chefProfileId: { in: ids }, weekStart: start },
        include: { menu: { include: MENU_DISHES } },
      }),
      this.prisma.meal.findMany({
        where: { chefProfileId: { in: ids }, status: MealStatus.published },
        orderBy: { publishedAt: 'desc' },
      }),
      this.cardExtras(ids),
    ]);

    this.logger.debug({
      event: 'vitrine.slots_computed',
      chefs: ids.length,
      ms: Date.now() - started,
    });

    const cards = chefs.flatMap((chef) => {
      const left = slotsLeft.get(chef.id) ?? null;
      // Fully booked drops out; no hours or no offer stays, "on request" (PRD).
      if (left === 0) return [];

      const menu = showcase.find((row) => row.chefProfileId === chef.id)?.menu;
      const live = menu && menu.status === MealStatus.published ? menu : null;
      const shown = live
        ? publishedDishes(live)
        : dishes.filter((dish) => dish.chefProfileId === chef.id);
      return [
        {
          menuId: live?.id ?? null,
          hasMenu: Boolean(live),
          chef: extras.chefCard(chef),
          title: live?.title ?? null,
          pitch: live?.pitch ?? null,
          imageUrl: live?.imageUrl ?? null,
          coveredDiets: coveredDiets(shown.map((dish) => ({ diets: dish.dietaryTags }))),
          // The week's menu, or one of the chef's offers: the client can book
          // the shopping done either way, and the filter must find this chef.
          shoppingIncluded:
            Boolean(live?.shoppingIncluded) || extras.offersShopping(chef.id),
          ...extras.price(chef.id),
          slotsLeft: left,
          dishes: shown.map(toPublicDish),
        },
      ];
    });

    const q = query.q?.trim().toLowerCase();
    const wanted = cards.filter(
      (card) =>
        (query.diets ?? []).every((diet) => card.coveredDiets.includes(diet)) &&
        (!query.shoppingIncluded || card.shoppingIncluded) &&
        (!q ||
          [
            card.chef.displayName,
            card.chef.city,
            card.title,
            ...card.dishes.map((d) => d.name),
          ]
            .filter(Boolean)
            .some((text) => text!.toLowerCase().includes(q))),
    );

    const ordered = vitrineOrder(
      wanted.map((card) => ({ ...card, chefId: card.chef.id })),
      week.start,
    ).map(({ chefId: _chefId, ...card }) => card);
    const bounds = resolvePageBounds(query);
    return {
      week,
      data: ordered.slice(bounds.skip, bounds.skip + bounds.take),
      meta: buildPaginationMeta(bounds, ordered.length),
    };
  }

  /** §5.2: a listed chef's public page, with published content only. */
  async chef(id: string) {
    const chef = await this.listedChef(id);
    const week = weekOf(parisDay(new Date()));
    const [extras, dishes, menus, slotsLeft, serviceOffers, legal] = await Promise.all([
      this.cardExtras([chef.id]),
      this.prisma.meal.findMany({
        where: { chefProfileId: chef.id, status: MealStatus.published },
        orderBy: { publishedAt: 'desc' },
      }),
      this.prisma.menu.findMany({
        where: { chefProfileId: chef.id, status: MealStatus.published },
        include: MENU_DISHES,
        orderBy: { publishedAt: 'desc' },
      }),
      this.availability.slotsLeftFor(
        [chef.id],
        parisMidnight(week.start),
        parisMidnight(toDay(new Date(toDate(week.start).getTime() + 7 * DAY_MS))),
      ),
      this.prisma.serviceOffer.findMany({
        where: { chefProfileId: chef.id, isActive: true },
        orderBy: [{ priceCents: 'asc' }, { durationMinutes: 'asc' }],
        select: {
          id: true,
          name: true,
          description: true,
          durationMinutes: true,
          priceCents: true,
          shoppingIncluded: true,
          shoppingFeeCents: true,
          mealsIncluded: true,
        },
      }),
      this.prisma.chefProfile.findUnique({
        where: { id: chef.id },
        select: CHEF_LEGAL_SELECT,
      }),
    ]);
    return {
      ...extras.chefCard(chef),
      // CGV art. 3.2: who the client contracts with, read before booking.
      legalIdentity: legal ? publicChefLegalIdentity(legal) : null,
      slotsLeft: slotsLeft.get(chef.id) ?? null,
      bio: chef.bio,
      zones: zonesOf(chef)
        .map((zone) => ({
          regionCode: zone.regionCode,
          regionLabel: zone.regionLabel ?? null,
          scope: zone.scope,
          cities: (zone.cities ?? [])
            .map((city) => ({ name: city.name, insee: city.insee }))
            .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'fr')),
        }))
        .sort((a, b) =>
          (a.regionLabel ?? a.regionCode).localeCompare(
            b.regionLabel ?? b.regionCode,
            'fr',
          ),
        ),
      ...extras.price(chef.id),
      // The amounts the client reads before booking, signed in or not: the
      // shopping fee comes with the offer, and the tax credit covers both.
      serviceOffers: serviceOffers.map((offer) => {
        const clientPriceCents = offerClientCents(offer);
        return {
          ...offer,
          clientPriceCents,
          afterTaxCreditCents: afterTaxCredit(clientPriceCents),
        };
      }),
      dishes: dishes.map(toPublicDish),
      menus: menus.map(toPublicMenu),
    };
  }

  /** §3.5's public side: the menu a listed chef shows each week, when published. */
  async showcase(id: string, range: ChefShowcaseQueryDto) {
    const chef = await this.listedChef(id);
    const from = weekOf(range.from ?? parisDay(new Date())).start;
    const to = range.to ?? toDay(new Date(toDate(from).getTime() + 7 * 7 * DAY_MS));
    const span = toDate(to).getTime() - toDate(from).getTime();
    if (span < 0) throw validationFailed('`to` is before `from`.');
    if (span > MAX_SHOWCASE_WEEKS * 7 * DAY_MS) {
      throw validationFailed(`Ask for ${MAX_SHOWCASE_WEEKS} weeks at most.`);
    }

    const rows = await this.prisma.chefShowcaseWeek.findMany({
      where: {
        chefProfileId: chef.id,
        weekStart: { gte: toDate(from), lte: toDate(to) },
      },
      include: { menu: { include: MENU_DISHES } },
      orderBy: { weekStart: 'asc' },
    });
    return {
      from,
      to,
      weeks: rows.map((row) => ({
        weekStart: toDay(row.weekStart),
        menu:
          row.menu && row.menu.status === MealStatus.published
            ? toPublicMenu(row.menu)
            : null,
      })),
    };
  }

  private async listedChef(id: string): Promise<PublicChef> {
    const chef = await this.prisma.chefProfile.findFirst({
      where: { id, ...LISTED_CHEF },
      select: PUBLIC_CHEF_FIELDS,
    });
    if (!chef) throw new NotFoundException('No such batch cooker.');
    return chef;
  }

  /**
   * What a card says about the cook beyond their menu: badges from validated
   * documents, prestations delivered, and the lowest price. Fetched once for all
   * the chefs on the page.
   */
  private async cardExtras(ids: string[]) {
    const [documents, sessions, offers] = await Promise.all([
      this.prisma.chefDocument.findMany({
        where: {
          chefProfileId: { in: ids },
          type: { in: Object.keys(BADGE) as ChefDocumentType[] },
        },
        orderBy: { version: 'desc' },
        select: { chefProfileId: true, type: true, status: true },
      }),
      this.prisma.booking.groupBy({
        by: ['chefProfileId'],
        where: { chefProfileId: { in: ids }, status: BookingStatus.completed },
        _count: { _all: true },
      }),
      // The internal custom offer is never active, so it never shows here.
      this.prisma.serviceOffer.findMany({
        where: { chefProfileId: { in: ids }, isActive: true },
        select: {
          chefProfileId: true,
          priceCents: true,
          shoppingIncluded: true,
          shoppingFeeCents: true,
        },
      }),
    ]);

    // Only the latest version of each document counts, as in the dossier.
    const latest = new Map<string, ChefDocumentStatus>();
    for (const doc of documents) {
      const key = `${doc.chefProfileId}:${doc.type}`;
      if (!latest.has(key)) latest.set(key, doc.status);
    }
    const valid = new Set<ChefDocumentStatus>([
      ChefDocumentStatus.valid,
      ChefDocumentStatus.expiring,
    ]);

    return {
      chefCard: (chef: PublicChef) => {
        const sessionsDone =
          sessions.find((row) => row.chefProfileId === chef.id)?._count._all ?? 0;
        return {
          id: chef.id,
          displayName: chef.displayName,
          city: chef.city,
          regionCode: zonesOf(chef)[0]?.regionCode ?? null,
          badges: (Object.entries(BADGE) as [ChefDocumentType, string][])
            .filter(([type]) => valid.has(latest.get(`${chef.id}:${type}`)!))
            .map(([, badge]) => badge),
          sessionsDone,
          newcomer: sessionsDone === 0,
          avatarUrl: chef.user.avatarUrl,
          // The NAN itself is on `GET /chefs/{id}/cesu-info`, read before paying.
          acceptsCesu: cesuAccepted(chef.sapProfile, chef.sepaMandate),
          // No source for these yet: shown empty rather than invented.
          rating: null,
          reviewCount: null,
          languages: chef.languages,
        };
      },
      /** A chef does the shopping in at least one active offer. */
      offersShopping: (chefId: string) =>
        offers.some((row) => row.chefProfileId === chefId && row.shoppingIncluded),
      /**
       * ponytail: the cheapest active service offer, shopping fee included. The spec wants the
       * client price (chef's net plus commission); the commission lives on the
       * payments branch. Add it here when that lands.
       */
      price: (chefId: string) => {
        // What the client pays for the offer alone: the shopping fee is billed
        // with it when the chef does the shopping (`bookingAmounts`).
        const totals = offers
          .filter((row) => row.chefProfileId === chefId)
          .map(offerClientCents);
        const from = totals.length > 0 ? Math.min(...totals) : null;
        return {
          sessionFromCents: from,
          // "Services à la personne": half comes back as a tax credit.
          afterTaxCreditCents: from === null ? null : afterTaxCredit(from),
        };
      },
    };
  }
}

function toPublicMenu(menu: MenuWithDishes) {
  const dishes = publishedDishes(menu);
  return {
    id: menu.id,
    title: menu.title,
    pitch: menu.pitch,
    imageUrl: menu.imageUrl,
    period: menu.period,
    shoppingIncluded: menu.shoppingIncluded,
    coveredDiets: coveredDiets(dishes.map((dish) => ({ diets: dish.dietaryTags }))),
    dishes: dishes.map(toPublicDish),
  };
}

/** `chef_profiles.intervention_zones`, as FLOW-01 copies it from the candidature. */
type StoredZone = Omit<InterventionZone, 'cities'> & {
  regionLabel?: string;
  cities?: { insee: string; name?: string }[];
};

function zonesOf(chef: Pick<ChefProfile, 'interventionZones'>): StoredZone[] {
  return Array.isArray(chef.interventionZones)
    ? (chef.interventionZones as unknown as StoredZone[])
    : [];
}

const toDate = (day: string) => new Date(`${day}T00:00:00Z`);
const toDay = (date: Date) => date.toISOString().slice(0, 10);
