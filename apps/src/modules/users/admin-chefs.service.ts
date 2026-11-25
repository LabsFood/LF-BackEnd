import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import {
  Paginated,
  buildPaginationMeta,
  resolvePageBounds,
} from '../../common/dto/pagination.dto';
import { GeoService } from '../../integrations/geo.service';
import { ChefTier, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { feedInUse } from '../calendar/calendar-feed.service';
import { chefTierLabels } from '../platform-settings/chef-tiers';
import {
  METROPOLITAN_REGIONS,
  toWire,
} from '../chef-onboarding/domain/chef-onboarding.rules';
import { InterventionZoneDto } from '../chef-onboarding/dto/create-chef-application.dto';
import {
  ChefState,
  ChefStateFilter,
  ListAdminChefsQueryDto,
} from './dto/admin-chefs.dto';
import { CHEF_LEGAL_SELECT, chefLegalIdentity } from './chef-legal.views';
import { assertInterventionZones } from './intervention-zones.check';

const REGION_LABEL = new Map<string, string>(
  METROPOLITAN_REGIONS.map((r) => [r.code, r.label]),
);

/** The storefront counts, without loading the rows behind them. */
const CONTENT_COUNTS = {
  select: {
    dishes: { where: { status: 'published' } },
    menus: { where: { status: 'published' } },
  },
} satisfies Prisma.ChefProfileCountOutputTypeDefaultArgs;

const CHEF_SELECT = {
  id: true,
  userId: true,
  displayName: true,
  bio: true,
  city: true,
  serviceRadiusKm: true,
  isActive: true,
  isVerified: true,
  autoSuspendedAt: true,
  tier: true,
  interventionZones: true,
  sapPath: true,
  // `sapDeclarationNumber` comes with the legal fields below.
  // CGV art. 3.2: the identity clients read, and its gaps.
  ...CHEF_LEGAL_SELECT,
  sapProfile: {
    select: {
      crcesuAffiliationStatus: true,
      urssafTiersPrestationStatus: true,
      novaCode: true,
    },
  },
  stripeAccountId: true,
  calendarFeed: { select: { lastFetchedAt: true } },
  createdAt: true,
  user: {
    select: { fullName: true, email: true, phone: true, avatarUrl: true },
  },
  application: {
    select: {
      id: true,
      reference: true,
      status: true,
      interventionZones: true,
      submittedAt: true,
      decidedAt: true,
    },
  },
  _count: CONTENT_COUNTS,
} satisfies Prisma.ChefProfileSelect;

type ChefRow = Prisma.ChefProfileGetPayload<{ select: typeof CHEF_SELECT }>;

interface BookingCounts {
  upcoming: number;
  completed: number;
}

/** A declared zone, as the candidature form stores it. */
interface StoredZone {
  regionCode?: unknown;
  scope?: unknown;
  cities?: unknown;
}

interface StoredCity {
  name?: unknown;
  dept?: unknown;
  insee?: unknown;
}

/**
 * The exact condition of each state. One place: the list filter, the counts and
 * the `state` on every row all read it, so they cannot disagree.
 */
const STATE_WHERE: Record<ChefStateFilter, Prisma.ChefProfileWhereInput> = {
  online: { isVerified: true, isActive: true },
  offline: { isVerified: true, isActive: false, autoSuspendedAt: null },
  suspended: { isVerified: true, isActive: false, autoSuspendedAt: { not: null } },
  pending: { isVerified: false },
  verified: { isVerified: true },
};

/**
 * A deleted account keeps its row when bookings reference it, emptied of what
 * identified the person. It is not a batch cooker any more: never listed.
 */
const LIVE_ACCOUNT: Prisma.ChefProfileWhereInput = { user: { deletedAt: null } };

/**
 * Every batch cooker of the platform, for the back office.
 *
 * Built on `chef_profiles`, not on candidatures: a profile created before the
 * candidature flow, or by hand, has no candidature and must still be listed.
 */
@Injectable()
export class AdminChefsService {
  private readonly logger = new Logger(AdminChefsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly geo: GeoService,
  ) {}

  async list(
    query: ListAdminChefsQueryDto,
  ): Promise<Paginated<ReturnType<typeof toItem>>> {
    const bounds = resolvePageBounds(query);
    const where = this.where(query);

    const [rows, total] = await Promise.all([
      this.prisma.chefProfile.findMany({
        where,
        select: CHEF_SELECT,
        orderBy:
          query.sort === 'name'
            ? [{ displayName: 'asc' }, { id: 'asc' }]
            : [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: bounds.skip,
        take: bounds.take,
      }),
      this.prisma.chefProfile.count({ where }),
    ]);
    const [bookings, tierLabels] = await Promise.all([
      this.bookingCounts(rows.map((r) => r.id)),
      chefTierLabels(this.prisma),
    ]);

    return {
      data: rows.map((row) => toItem(row, tierLabels, bookings.get(row.id))),
      meta: buildPaginationMeta(bounds, total),
    };
  }

  /** How many batch cookers are in each state: the tabs of the list. */
  async counts(): Promise<Record<ChefState | 'all', number>> {
    const count = (state?: ChefStateFilter) =>
      this.prisma.chefProfile.count({
        where: state ? { AND: [LIVE_ACCOUNT, STATE_WHERE[state]] } : LIVE_ACCOUNT,
      });
    const [all, online, offline, suspended, pending] = await Promise.all([
      count(),
      count('online'),
      count('offline'),
      count('suspended'),
      count('pending'),
    ]);
    return { all, online, offline, suspended, pending };
  }

  async get(id: string) {
    const row = await this.prisma.chefProfile.findFirst({
      where: { AND: [LIVE_ACCOUNT, { id }] },
      select: CHEF_SELECT,
    });
    if (!row) {
      throw new NotFoundException({
        code: 'CHEF_NOT_FOUND',
        message: 'No batch cooker with this id.',
      });
    }
    const [bookings, tierLabels] = await Promise.all([
      this.bookingCounts([row.id]),
      chefTierLabels(this.prisma),
    ]);
    return {
      ...toItem(row, tierLabels, bookings.get(row.id)),
      bio: row.bio,
      serviceRadiusKm: row.serviceRadiusKm,
      sapPath: row.sapPath ? toWire(row.sapPath) : null,
      sapDeclarationNumber: row.sapDeclarationNumber,
      // Set by `PATCH /admin/chefs/{id}/sap-external-status`; null until the batch
      // cooker has declared a SAP route.
      crcesuAffiliationStatus: row.sapProfile?.crcesuAffiliationStatus ?? null,
      urssafTiersPrestationStatus: row.sapProfile?.urssafTiersPrestationStatus ?? null,
      zones: zonesOf(row),
      // What clients read before booking, and what they cannot yet (never blocks).
      legalIdentity: chefLegalIdentity(row),
      // Whether the integrations are connected, never their identifiers.
      payoutsConnected: row.stripeAccountId !== null,
      // Their calendar app syncs our feed: fetched in the last 7 days.
      calendarConnected: feedInUse(row.calendarFeed?.lastFetchedAt),
      application: row.application
        ? {
            id: row.application.id,
            reference: row.application.reference,
            status: toWire(row.application.status),
            submittedAt: row.application.submittedAt,
            decidedAt: row.application.decidedAt,
          }
        : null,
    };
  }

  /**
   * `PATCH /admin/chefs/{id}/zones`: replaces the zones of an approved batch cooker.
   * The batch cooker does the same for themselves at `PATCH /me/chef-profile/zones`;
   * this one is for the team acting on their behalf. Before approval the zones are
   * the candidature's, changed there.
   */
  async setZones(id: string, zones: InterventionZoneDto[], adminClerkUserId: string) {
    await assertInterventionZones(zones, this.geo);

    const [chef, admin] = await Promise.all([
      this.prisma.chefProfile.findFirst({
        where: { AND: [LIVE_ACCOUNT, { id }] },
        select: { isVerified: true, interventionZones: true },
      }),
      this.prisma.user.findUnique({
        where: { clerkUserId: adminClerkUserId },
        select: { id: true },
      }),
    ]);
    if (!chef) {
      throw new NotFoundException({
        code: 'CHEF_NOT_FOUND',
        message: 'No batch cooker with this id.',
      });
    }
    if (!chef.isVerified) {
      throw new ConflictException({
        code: 'CHEF_NOT_VERIFIED',
        message: 'Not approved yet: the zones are the candidature’s until then.',
      });
    }

    await this.prisma.chefProfile.update({
      where: { id },
      data: { interventionZones: zones as unknown as Prisma.InputJsonValue },
    });
    this.logger.log({
      event: 'chef.zones_changed',
      chefProfileId: id,
      regionCodes: zones.map((zone) => zone.regionCode),
    });
    await this.audit.record({
      actorType: 'admin',
      // AdminGuard has just read the admin's row.
      actorUserId: admin?.id ?? null,
      action: 'chef.zones_changed',
      subjectType: 'chef_profile',
      subjectId: id,
      metadata: { before: chef.interventionZones, after: zones },
    });

    return this.get(id);
  }

  /**
   * `PATCH /admin/chefs/{id}/tier` (Recettes R34). Only a label for now: no billing,
   * and publishing does not depend on it until product decides which tiers publish.
   */
  async setTier(id: string, tier: ChefTier, adminClerkUserId: string) {
    const [chef, admin] = await Promise.all([
      this.prisma.chefProfile.findFirst({
        where: { AND: [LIVE_ACCOUNT, { id }] },
        select: { tier: true },
      }),
      this.prisma.user.findUnique({
        where: { clerkUserId: adminClerkUserId },
        select: { id: true },
      }),
    ]);
    if (!chef) {
      throw new NotFoundException({
        code: 'CHEF_NOT_FOUND',
        message: 'No batch cooker with this id.',
      });
    }

    await this.prisma.chefProfile.update({ where: { id }, data: { tier } });
    this.logger.log({
      event: 'chef.tier_changed',
      chefProfileId: id,
      from: chef.tier,
      to: tier,
    });
    await this.audit.record({
      actorType: 'admin',
      // AdminGuard has just read the admin's row.
      actorUserId: admin?.id ?? null,
      action: 'chef.tier_changed',
      subjectType: 'chef_profile',
      subjectId: id,
      metadata: { before: chef.tier, after: tier },
    });

    return this.get(id);
  }

  private where(query: ListAdminChefsQueryDto): Prisma.ChefProfileWhereInput {
    const and: Prisma.ChefProfileWhereInput[] = [LIVE_ACCOUNT];
    if (query.state) and.push(STATE_WHERE[query.state]);

    if (query.q) {
      const contains = { contains: query.q, mode: 'insensitive' as const };
      and.push({
        OR: [
          { displayName: contains },
          { city: contains },
          { user: { fullName: contains } },
          { user: { email: contains } },
          { application: { reference: contains } },
        ],
      });
    }

    if (query.region) {
      // The zones are copied onto the profile at approval. Before that they only
      // exist on the candidature, so a pending batch cooker is matched there.
      const covers = { array_contains: [{ regionCode: query.region }] };
      and.push({
        OR: [
          { interventionZones: covers },
          { application: { interventionZones: covers } },
        ],
      });
    }
    return { AND: and };
  }

  /** Bookings ahead and done, for a page of batch cookers, in one query. */
  private async bookingCounts(ids: string[]): Promise<Map<string, BookingCounts>> {
    const counts = new Map<string, BookingCounts>();
    if (ids.length === 0) return counts;

    const groups = await this.prisma.booking.groupBy({
      by: ['chefProfileId', 'status'],
      where: { chefProfileId: { in: ids }, status: { not: 'cancelled' } },
      _count: { _all: true },
    });
    for (const group of groups) {
      const entry = counts.get(group.chefProfileId) ?? { upcoming: 0, completed: 0 };
      if (group.status === 'completed') entry.completed += group._count._all;
      else entry.upcoming += group._count._all;
      counts.set(group.chefProfileId, entry);
    }
    return counts;
  }
}

function stateOf(
  row: Pick<ChefRow, 'isVerified' | 'isActive' | 'autoSuspendedAt'>,
): ChefState {
  if (!row.isVerified) return 'pending';
  if (row.isActive) return 'online';
  return row.autoSuspendedAt ? 'suspended' : 'offline';
}

/** The profile's zones once approved, the candidature's until then. */
function storedZones(row: ChefRow): StoredZone[] {
  const own = row.interventionZones;
  if (Array.isArray(own) && own.length > 0) return own as StoredZone[];
  const declared = row.application?.interventionZones;
  return Array.isArray(declared) ? (declared as StoredZone[]) : [];
}

function zonesOf(row: ChefRow) {
  return storedZones(row)
    .filter((zone) => typeof zone.regionCode === 'string')
    .map((zone) => ({
      regionCode: zone.regionCode as string,
      regionLabel:
        REGION_LABEL.get(zone.regionCode as string) ?? (zone.regionCode as string),
      scope: zone.scope === 'cities' ? ('cities' as const) : ('region' as const),
      // Whole, as stored: what is read here goes back as is to `PATCH …/zones`.
      cities: Array.isArray(zone.cities)
        ? (zone.cities as StoredCity[])
            .filter((city) => typeof city?.name === 'string')
            .map((city) => ({
              name: city.name as string,
              dept: typeof city.dept === 'string' ? city.dept : null,
              insee: typeof city.insee === 'string' ? city.insee : null,
            }))
            .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
        : [],
    }))
    .sort((a, b) => a.regionLabel.localeCompare(b.regionLabel, 'fr'));
}

function toItem(
  row: ChefRow,
  tierLabels: Record<ChefTier, string>,
  bookings?: BookingCounts,
) {
  return {
    /** The batch cooker page id (`chefProfile.id`): the `{id}` of every `/admin/chefs/…` route. */
    id: row.id,
    /** The account id, for the routes that address the person. */
    userId: row.userId,
    displayName: row.displayName,
    fullName: row.user.fullName,
    email: row.user.email,
    phone: row.user.phone,
    avatarUrl: row.user.avatarUrl,
    city: row.city,
    state: stateOf(row),
    isVerified: row.isVerified,
    isActive: row.isActive,
    autoSuspendedAt: row.autoSuspendedAt,
    /** Recettes R34: the code, and the name an admin gave it. */
    tier: row.tier,
    tierLabel: tierLabels[row.tier],
    // Back online on a replacement document nobody has reviewed yet.
    reactivatedPendingReview: Boolean(row.autoSuspendedAt && row.isActive),
    regions: zonesOf(row).map((zone) => ({
      code: zone.regionCode,
      label: zone.regionLabel,
    })),
    /** CGV art. 3.2: everything a client must read before booking is filled. */
    legalIdentityComplete: chefLegalIdentity(row).missing.length === 0,
    application: row.application
      ? {
          id: row.application.id,
          reference: row.application.reference,
          status: toWire(row.application.status),
        }
      : null,
    counts: {
      publishedDishes: row._count.dishes,
      publishedMenus: row._count.menus,
      upcomingBookings: bookings?.upcoming ?? 0,
      completedBookings: bookings?.completed ?? 0,
    },
    createdAt: row.createdAt,
  };
}
