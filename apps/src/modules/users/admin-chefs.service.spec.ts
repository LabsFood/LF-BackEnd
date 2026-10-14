import { NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { AdminChefsService } from './admin-chefs.service';

const PACA = [{ regionCode: '93', scope: 'cities', cities: [{ name: 'Nice' }] }];
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
  stripeAccountId: 'acct_secret',
  cronofyProfileId: null,
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
  ...overrides,
});

describe('AdminChefsService', () => {
  let service: AdminChefsService;
  let prisma: {
    chefProfile: { findMany: jest.Mock; findFirst: jest.Mock; count: jest.Mock };
    booking: { groupBy: jest.Mock };
  };

  /** The conditions the list query was run with. */
  const conditions = () => prisma.chefProfile.findMany.mock.calls[0][0].where.AND;

  beforeEach(() => {
    prisma = {
      chefProfile: {
        findMany: jest.fn().mockResolvedValue([row()]),
        findFirst: jest.fn().mockResolvedValue(row()),
        count: jest.fn().mockResolvedValue(1),
      },
      booking: { groupBy: jest.fn().mockResolvedValue([]) },
    };
    service = new AdminChefsService(prisma as unknown as PrismaService);
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

    it('lists the cities of each zone', async () => {
      const chef = await service.get('chef-1');
      expect(chef.zones).toEqual([
        {
          regionCode: '93',
          regionLabel: "Provence-Alpes-Côte d'Azur",
          scope: 'cities',
          cities: ['Nice'],
        },
      ]);
    });

    it('answers 404 for an unknown or deleted batch cooker', async () => {
      prisma.chefProfile.findFirst.mockResolvedValue(null);
      await expect(service.get('nope')).rejects.toThrow(NotFoundException);
    });
  });
});
