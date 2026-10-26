import { NotFoundException } from '@nestjs/common';

import { MealStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AvailabilityService } from '../calendar/availability.service';
import { dishRow, menuRow } from './dishes.test-helpers';
import { VitrineService } from './vitrine.service';

const chef = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  displayName: `Chef ${id}`,
  city: 'Nice',
  bio: null,
  user: { avatarUrl: null },
  isVerified: true,
  isActive: true,
  interventionZones: [{ regionCode: '93', scope: 'region', cities: [] }],
  ...overrides,
});

const WITH_RECIPE = {
  status: MealStatus.published,
  ingredients: [{ name: 'Ail', qty: 2, unit: 'gousse', aisle: 'fruits-legumes' }],
  steps: ['Éplucher'],
};

function vitrine(data: {
  chefs?: unknown[];
  slotsLeft?: Record<string, number | null>;
  showcase?: unknown[];
  dishes?: unknown[];
  documents?: unknown[];
}) {
  const prisma = {
    chefProfile: {
      findMany: jest.fn(async () => data.chefs ?? []),
      findFirst: jest.fn(async () => (data.chefs ?? [])[0] ?? null),
    },
    chefShowcaseWeek: { findMany: jest.fn(async () => data.showcase ?? []) },
    meal: { findMany: jest.fn(async () => data.dishes ?? []) },
    menu: { findMany: jest.fn(async () => []) },
    chefDocument: { findMany: jest.fn(async () => data.documents ?? []) },
    booking: { groupBy: jest.fn(async () => []) },
    serviceOffer: {
      groupBy: jest.fn(async () => [{ chefProfileId: 'a', _min: { priceCents: 15000 } }]),
    },
  };
  const availability = {
    slotsLeftFor: jest.fn(async () => new Map(Object.entries(data.slotsLeft ?? {}))),
  };
  return {
    prisma,
    availability,
    service: new VitrineService(
      prisma as unknown as PrismaService,
      availability as unknown as AvailabilityService,
    ),
  };
}

describe('VitrineService', () => {
  describe('GET /menus/week (§5.1)', () => {
    it('only ever lists approved chefs who are online', async () => {
      const { prisma, service } = vitrine({});
      await service.week({});

      expect(prisma.chefProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isVerified: true, isActive: true } }),
      );
      // Only public fields are ever read from the profile.
      const [[{ select }]] = prisma.chefProfile.findMany.mock.calls as unknown as [
        [{ select: Record<string, boolean> }],
      ];
      expect(Object.keys(select).sort()).toEqual([
        'bio',
        'city',
        'displayName',
        'id',
        'interventionZones',
        'languages',
        'sapProfile',
        'sepaMandate',
        'user',
      ]);
      // Of the account, the photo only: never the email or the phone.
      expect(select.user).toEqual({ select: { avatarUrl: true } });
      // Of the SAP file, what `acceptsCesu` needs: never the NOVA or the cooperative.
      expect(select.sapProfile).toEqual({
        select: { acceptsCesu: true, crcesuNan: true },
      });
      // Of the mandate, its status: `acceptsCesu` needs it, the IBAN is never read.
      expect(select.sepaMandate).toEqual({ select: { status: true } });
    });

    it('shows the week’s menu with its published dishes only, and never a recipe', async () => {
      const menu = menuRow(
        { id: 'm1', chefProfileId: 'a', status: MealStatus.published },
        [
          dishRow({ id: 'd1', ...WITH_RECIPE, dietaryTags: ['halal', 'gluten-free'] }),
          dishRow({ id: 'd2', status: MealStatus.suspended }),
          dishRow({ id: 'd3', ...WITH_RECIPE, dietaryTags: ['halal'] }),
        ],
      );
      const { service } = vitrine({
        chefs: [chef('a')],
        showcase: [{ chefProfileId: 'a', menu }],
      });

      const { data } = await service.week({ week: '2026-09-24' });

      expect(data[0]).toMatchObject({
        menuId: 'm1',
        hasMenu: true,
        coveredDiets: ['halal'],
        sessionFromCents: 15000,
        afterTaxCreditCents: 7500,
      });
      expect(data[0].dishes.map((d) => d.id)).toEqual(['d1', 'd3']);
      expect(JSON.stringify(data)).not.toMatch(/ingredients|steps|Éplucher/);
    });

    it('lists a chef without a menu last, marked, with their published dishes', async () => {
      const menu = menuRow({ chefProfileId: 'b', status: MealStatus.published }, [
        dishRow({ ...WITH_RECIPE }),
      ]);
      const { service } = vitrine({
        chefs: [chef('a'), chef('b')],
        showcase: [{ chefProfileId: 'b', menu }],
        dishes: [dishRow({ id: 'a-dish', chefProfileId: 'a', ...WITH_RECIPE })],
      });

      const { data } = await service.week({});

      expect(data.map((card) => [card.chef.id, card.hasMenu])).toEqual([
        ['b', true],
        ['a', false],
      ]);
      expect(data[1].dishes.map((d) => d.id)).toEqual(['a-dish']);
    });

    it('drops a fully booked chef but keeps one with no hours, as available on request', async () => {
      const { service, availability } = vitrine({
        chefs: [chef('full'), chef('open'), chef('free')],
        slotsLeft: { full: 0, open: null, free: 3 },
      });

      const { data } = await service.week({});

      expect(data.map((card) => [card.chef.id, card.slotsLeft]).sort()).toEqual([
        ['free', 3],
        ['open', null],
      ]);
      // One batched count for every chef on the page, over the week.
      expect(availability.slotsLeftFor).toHaveBeenCalledTimes(1);
      expect(availability.slotsLeftFor).toHaveBeenCalledWith(
        ['full', 'open', 'free'],
        expect.any(Date),
        expect.any(Date),
      );
    });

    it('filters on area, on diets covered by the whole menu, and on free text', async () => {
      const { service } = vitrine({
        chefs: [
          chef('a'),
          chef('elsewhere', {
            interventionZones: [{ regionCode: '11', scope: 'region' }],
          }),
        ],
        dishes: [
          dishRow({
            chefProfileId: 'a',
            name: 'Pho Bo',
            ...WITH_RECIPE,
            dietaryTags: ['halal'],
          }),
        ],
      });

      expect((await service.week({ region: '93' })).data.map((c) => c.chef.id)).toEqual([
        'a',
      ]);
      expect((await service.week({ region: '93', diets: ['vegan'] })).data).toEqual([]);
      expect((await service.week({ region: '93', q: 'pho' })).data).toHaveLength(1);
      expect((await service.week({ shoppingIncluded: true })).data).toEqual([]);
    });

    it('turns validated documents into badges, and ignores a refused newer version', async () => {
      const { service } = vitrine({
        chefs: [chef('a')],
        documents: [
          { chefProfileId: 'a', type: 'haccp', status: 'valid' },
          { chefProfileId: 'a', type: 'rc_pro', status: 'rejected' },
          { chefProfileId: 'a', type: 'rc_pro', status: 'valid' },
        ],
      });

      const { data } = await service.week({});

      expect(data[0].chef.badges).toEqual(['haccp']);
    });

    it('shows the chef’s profile photo on their card', async () => {
      const photo = 'https://photos.labsfood.fr/users/u-a/avatar/ph_1.jpg';
      const { service } = vitrine({ chefs: [chef('a', { user: { avatarUrl: photo } })] });

      const { data } = await service.week({});

      expect(data[0].chef.avatarUrl).toBe(photo);
    });

    it('shows the languages the chef speaks on their card', async () => {
      const { service } = vitrine({ chefs: [chef('a', { languages: ['fr', 'wo'] })] });

      const { data } = await service.week({});

      expect(data[0].chef.languages).toEqual(['fr', 'wo']);
    });
  });

  it('answers 404 for a chef who is not listed', async () => {
    const { service } = vitrine({ chefs: [] });
    await expect(service.chef('nobody')).rejects.toBeInstanceOf(NotFoundException);
  });
});
