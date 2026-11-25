import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { GeoService } from '../../integrations/geo.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminChefsService } from './admin-chefs.service';

const NICE = { name: 'Nice', dept: '06', insee: '06088' };
const PACA = [{ regionCode: '93', scope: 'cities', cities: [NICE] }];
const IDF = [{ regionCode: '11', scope: 'region', cities: [] }];

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'chef-1',
  userId: 'user-1',
  displayName: 'Marie Dupont',
  bio: null,
  city: 'Nice',
  serviceRadiusKm: 30,
  isActive: true,
  isVerified: true,
  autoSuspendedAt: null,
  interventionZones: PACA,
  sapPath: 'type_b',
  sapDeclarationNumber: null,
  sapProfile: {
    urssafTiersPrestationStatus: 'pending',
  },
  stripeAccountId: 'acct_secret',
  calendarFeed: null,
  createdAt: new Date('2026-09-21T08:30:00.000Z'),
  user: {
    fullName: 'Marie Dupont',
    email: 'marie@exemple.fr',
    phone: null,
    avatarUrl: null,
  },
  application: {
    id: 'app-1',
    reference: 'CAND-2026-0042',
    status: 'changes_requested',
    interventionZones: IDF,
    submittedAt: new Date('2026-09-21T08:30:00.000Z'),
    decidedAt: null,
  },
  _count: { dishes: 12, menus: 3 },
  tier: 'tier_1',
  ...overrides,
});

describe('AdminChefsService', () => {
  let service: AdminChefsService;
  let prisma: {
    chefProfile: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
    };
    user: { findUnique: jest.Mock };
    booking: { groupBy: jest.Mock };
    platformSetting: { findUnique: jest.Mock };
  };
  let audit: { record: jest.Mock };
  /** geo.api.gouv.fr, as far as these tests go. */
  const geo = {
    communesByRegion: jest.fn(
      async (code: string) =>
        ({
          '84': [{ nom: 'Lyon', code: '69123', codeDepartement: '69' }],
          '93': [{ nom: 'Nice', code: '06088', codeDepartement: '06' }],
        })[code] ?? [],
    ),
  };

  /** The conditions the list query was run with. */
  const conditions = () => prisma.chefProfile.findMany.mock.calls[0][0].where.AND;

  beforeEach(() => {
    prisma = {
      chefProfile: {
        findMany: jest.fn().mockResolvedValue([row()]),
        findFirst: jest.fn().mockResolvedValue(row()),
        count: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue({}),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'admin-1' }) },
      booking: { groupBy: jest.fn().mockResolvedValue([]) },
      platformSetting: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new AdminChefsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      geo as unknown as GeoService,
    );
  });

  describe('state', () => {
    it.each([
      [{ isVerified: false, isActive: false }, 'pending'],
      [{ isVerified: true, isActive: true }, 'online'],
      [{ isVerified: true, isActive: false, autoSuspendedAt: null }, 'offline'],
      [{ isVerified: true, isActive: false, autoSuspendedAt: new Date() }, 'suspended'],
    ])('%p is %s', async (flags, state) => {
      prisma.chefProfile.findMany.mockResolvedValue([row(flags)]);
      const { data } = await service.list({});
      expect(data[0].state).toBe(state);
    });

    it('stays online, and says so, when live on an unreviewed replacement document', async () => {
      prisma.chefProfile.findMany.mockResolvedValue([
        row({ isActive: true, autoSuspendedAt: new Date() }),
      ]);
      const { data } = await service.list({});
      expect(data[0]).toMatchObject({ state: 'online', reactivatedPendingReview: true });
    });

    it('filters with the same condition the state is computed from', async () => {
      await service.list({ state: 'suspended' });
      expect(conditions()).toContainEqual({
        isVerified: true,
        isActive: false,
        autoSuspendedAt: { not: null },
      });
    });
  });

  describe('list', () => {
    it('never lists a deleted account', async () => {
      await service.list({});
      expect(conditions()).toContainEqual({ user: { deletedAt: null } });
    });

    it('matches a region on the profile and on the candidature', async () => {
      await service.list({ region: '11' });
      const covers = { array_contains: [{ regionCode: '11' }] };
      expect(conditions()).toContainEqual({
        OR: [
          { interventionZones: covers },
          { application: { interventionZones: covers } },
        ],
      });
    });

    it('counts bookings ahead and done, and ignores none of the statuses it is given', async () => {
      prisma.booking.groupBy.mockResolvedValue([
        { chefProfileId: 'chef-1', status: 'pending', _count: { _all: 1 } },
        { chefProfileId: 'chef-1', status: 'confirmed', _count: { _all: 2 } },
        { chefProfileId: 'chef-1', status: 'completed', _count: { _all: 9 } },
      ]);
      const { data } = await service.list({});
      expect(data[0].counts).toEqual({
        publishedDishes: 12,
        publishedMenus: 3,
        upcomingBookings: 3,
        completedBookings: 9,
      });
      expect(prisma.booking.groupBy.mock.calls[0][0].where.status).toEqual({
        not: 'cancelled',
      });
    });

    it('serves the candidature status as the candidature routes do', async () => {
      const { data } = await service.list({});
      expect(data[0].application).toEqual({
        id: 'app-1',
        reference: 'CAND-2026-0042',
        status: 'changes-requested',
      });
    });

    it('reads the zones of the candidature while the profile has none', async () => {
      prisma.chefProfile.findMany.mockResolvedValue([row({ interventionZones: [] })]);
      const { data } = await service.list({});
      expect(data[0].regions).toEqual([{ code: '11', label: 'Île-de-France' }]);
    });
  });

  describe('get', () => {
    it('says whether integrations are connected, never their identifiers', async () => {
      const chef = await service.get('chef-1');
      expect(chef.payoutsConnected).toBe(true);
      expect(chef.calendarConnected).toBe(false);
      expect(JSON.stringify(chef)).not.toContain('acct_secret');
    });

    it('calls the calendar connected while its app fetched our feed this week', async () => {
      const fetched = (days: number) =>
        row({
          calendarFeed: { lastFetchedAt: new Date(Date.now() - days * 86_400_000) },
        });

      prisma.chefProfile.findFirst.mockResolvedValue(fetched(1));
      expect((await service.get('chef-1')).calendarConnected).toBe(true);

      prisma.chefProfile.findFirst.mockResolvedValue(fetched(8));
      expect((await service.get('chef-1')).calendarConnected).toBe(false);
    });

    it('lists the cities of each zone whole, as the zones route takes them', async () => {
      const chef = await service.get('chef-1');
      expect(chef.zones).toEqual([
        {
          regionCode: '93',
          regionLabel: "Provence-Alpes-Côte d'Azur",
          scope: 'cities',
          cities: [NICE],
        },
      ]);
    });

    it('gives null for what an older zone never stored', async () => {
      prisma.chefProfile.findFirst.mockResolvedValue(
        row({ interventionZones: [{ ...PACA[0], cities: [{ name: 'Nice' }] }] }),
      );
      const chef = await service.get('chef-1');
      expect(chef.zones[0].cities).toEqual([{ name: 'Nice', dept: null, insee: null }]);
    });

    it('reads back the URSSAF status an admin wrote, null before any declaration', async () => {
      const chef = await service.get('chef-1');
      expect(chef.urssafTiersPrestationStatus).toBe('pending');

      prisma.chefProfile.findFirst.mockResolvedValue(row({ sapProfile: null }));
      const undeclared = await service.get('chef-1');
      expect(undeclared.urssafTiersPrestationStatus).toBeNull();
    });

    it('answers 404 for an unknown or deleted batch cooker', async () => {
      prisma.chefProfile.findFirst.mockResolvedValue(null);
      await expect(service.get('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('setZones', () => {
    const LYON = [
      {
        regionCode: '84',
        regionLabel: 'Auvergne-Rhône-Alpes',
        scope: 'cities' as const,
        cities: [{ name: 'Lyon', dept: '69', insee: '69123' }],
      },
    ];

    it('replaces the zones and journals before and after', async () => {
      await service.setZones('chef-1', LYON, 'clerk-admin');

      expect(prisma.chefProfile.update).toHaveBeenCalledWith({
        where: { id: 'chef-1' },
        data: { interventionZones: LYON },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: 'admin',
          actorUserId: 'admin-1',
          action: 'chef.zones_changed',
          subjectId: 'chef-1',
          metadata: { before: PACA, after: LYON },
        }),
      );
    });

    it('takes back unchanged the zones it read', async () => {
      const { zones } = await service.get('chef-1');
      await service.setZones('chef-1', zones as never, 'clerk-admin');

      const [{ data }] = prisma.chefProfile.update.mock.calls[0] as [
        { data: { interventionZones: unknown } },
      ];
      expect(data.interventionZones).toEqual(zones);
      prisma.chefProfile.findFirst.mockResolvedValue(
        row({ interventionZones: data.interventionZones }),
      );
      expect((await service.get('chef-1')).zones).toEqual(zones);
    });

    it('leaves a batch cooker not approved yet to the candidature', async () => {
      prisma.chefProfile.findFirst.mockResolvedValue(row({ isVerified: false }));
      await expect(service.setZones('chef-1', LYON, 'clerk-admin')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.chefProfile.update).not.toHaveBeenCalled();
    });

    it.each([[[{ ...LYON[0], regionCode: '01' }]], [[{ ...LYON[0], cities: [] }]]])(
      'refuses zones the candidature would refuse: %j',
      async (zones) => {
        await expect(service.setZones('chef-1', zones, 'clerk-admin')).rejects.toThrow(
          UnprocessableEntityException,
        );
        expect(prisma.chefProfile.update).not.toHaveBeenCalled();
      },
    );

    it('refuses a town that is not the commune of its INSEE code, as the candidature does', async () => {
      const marseille = [
        { ...LYON[0], cities: [{ name: 'Marseille', dept: '13', insee: '13055' }] },
      ];
      await expect(
        service.setZones('chef-1', marseille, 'clerk-admin'),
      ).rejects.toMatchObject({ status: 422, response: { code: 'ZONE_CITY_UNKNOWN' } });
      expect(prisma.chefProfile.update).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown or deleted batch cooker', async () => {
      prisma.chefProfile.findFirst.mockResolvedValue(null);
      await expect(service.setZones('nope', LYON, 'clerk-admin')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('tier (Recettes R34)', () => {
    it('shows the tier with the label in force, on the list and on the detail', async () => {
      prisma.chefProfile.findFirst.mockResolvedValue(row({ tier: 'tier_2' }));
      prisma.platformSetting.findUnique.mockResolvedValue({
        value: { tier_2: 'Confirmé' },
      });

      const chef = await service.get('chef-1');
      const { data } = await service.list({});

      expect(chef).toMatchObject({ tier: 'tier_2', tierLabel: 'Confirmé' });
      expect(data[0]).toMatchObject({ tier: 'tier_1', tierLabel: 'Palier 1' });
    });

    it('changes the tier and journals before and after', async () => {
      await service.setTier('chef-1', 'tier_3', 'clerk-admin');

      expect(prisma.chefProfile.update).toHaveBeenCalledWith({
        where: { id: 'chef-1' },
        data: { tier: 'tier_3' },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: 'admin',
          actorUserId: 'admin-1',
          action: 'chef.tier_changed',
          subjectType: 'chef_profile',
          subjectId: 'chef-1',
          metadata: { before: 'tier_1', after: 'tier_3' },
        }),
      );
    });

    it('answers 404 for an unknown or deleted batch cooker', async () => {
      prisma.chefProfile.findFirst.mockResolvedValue(null);

      await expect(service.setTier('nope', 'tier_2', 'clerk-admin')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.chefProfile.update).not.toHaveBeenCalled();
    });
  });
});
