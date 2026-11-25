import { NotFoundException } from '@nestjs/common';

import { MealStatus } from '../../generated/prisma/client';
import { GeoService } from '../../integrations/geo.service';
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
  legal?: unknown;
  offers?: unknown[];
}) {
  const prisma = {
    chefProfile: {
      findMany: jest.fn(async () => data.chefs ?? []),
      findFirst: jest.fn(async () => (data.chefs ?? [])[0] ?? null),
      findUnique: jest.fn(async () => data.legal ?? null),
    },
    chefShowcaseWeek: { findMany: jest.fn(async () => data.showcase ?? []) },
    meal: { findMany: jest.fn(async () => data.dishes ?? []) },
    menu: { findMany: jest.fn(async () => []) },
    chefDocument: { findMany: jest.fn(async () => data.documents ?? []) },
    booking: { groupBy: jest.fn(async () => []) },
    serviceOffer: {
      findMany: jest.fn(
        async () =>
          data.offers ?? [
            {
              chefProfileId: 'a',
              priceCents: 15000,
              shoppingIncluded: false,
              shoppingFeeCents: 0,
            },
          ],
      ),
    },
  };
  const availability = {
    slotsLeftFor: jest.fn(async () => new Map(Object.entries(data.slotsLeft ?? {}))),
  };
  // The real commune check, over a stubbed geo.api.gouv.fr: 06000 serves Nice only.
  const geo = Object.assign(new GeoService(), {
    communesByPostcode: jest.fn(async (code: string) =>
      code === '06000'
        ? [{ nom: 'Nice', code: '06088', codeDepartement: '06', codeRegion: '93' }]
        : [],
    ),
  });
  return {
    prisma,
    availability,
    service: new VitrineService(
      prisma as unknown as PrismaService,
      availability as unknown as AvailabilityService,
      geo,
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

    it('counts an offer that does the shopping: its fee in the price, and the filter finds the chef', async () => {
      const { service } = vitrine({
        chefs: [chef('a')],
        offers: [
          {
            chefProfileId: 'a',
            priceCents: 5000,
            shoppingIncluded: true,
            shoppingFeeCents: 1500,
          },
          {
            chefProfileId: 'a',
            priceCents: 6000,
            shoppingIncluded: false,
            shoppingFeeCents: 0,
          },
        ],
      });

      const { data } = await service.week({ shoppingIncluded: true });

      expect(data).toHaveLength(1);
      expect(data[0]).toMatchObject({
        shoppingIncluded: true,
        // 50 € + 15 € of shopping is 65 €: the 60 € offer is the cheapest.
        sessionFromCents: 6000,
        afterTaxCreditCents: 3000,
      });
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

  describe('what the storefront shows of a dish (Recettes, lot 0)', () => {
    // The whole list: a field added to the public projection fails here until it is
    // listed on purpose. Times and calories are for the chef and the admin only.
    // Recettes §4.8 adds the computed and declared diets, the seasons and the
    // profiles. Never the chef's personal tags.
    const PUBLIC_DISH_KEYS = [
      'allergens',
      'allergensNone',
      'category',
      'computedDiets',
      'conditionalAllergens',
      'continent',
      'country',
      'customAllergens',
      'customDiets',
      'declaredDiets',
      'description',
      'diets',
      'difficulty',
      'id',
      'imageUrl',
      'name',
      'portions',
      'profiles',
      'seasonMonths',
    ];
    const dish = dishRow({ id: 'd1', ...WITH_RECIPE, calories: 640 });
    const menu = menuRow({ id: 'm1', chefProfileId: 'a', status: MealStatus.published }, [
      dish,
    ]);
    const { service } = vitrine({
      chefs: [chef('a')],
      showcase: [{ chefProfileId: 'a', weekStart: new Date('2026-09-21'), menu }],
      dishes: [dish],
    });

    it.each<[string, () => Promise<object[]>]>([
      [
        'GET /menus/week',
        async () => (await service.week({ week: '2026-09-21' })).data[0].dishes,
      ],
      ['GET /chefs/{id}', async () => (await service.chef('a')).dishes],
      [
        'GET /chefs/{id}/showcase',
        async () => (await service.showcase('a', {})).weeks[0].menu?.dishes ?? [],
      ],
    ])('%s lists only the public fields of a dish', async (_route, dishesOf) => {
      const dishes = await dishesOf();

      expect(dishes).toHaveLength(1);
      expect(Object.keys(dishes[0]).sort()).toEqual(PUBLIC_DISH_KEYS);
    });
  });

  it('shows the chef’s legal identity before booking, never the list of gaps', async () => {
    const { service } = vitrine({
      chefs: [chef('a')],
      legal: {
        legalName: 'Marie Dupont EI',
        legalStatus: 'micro_entreprise',
        siren: '443061841',
        businessAddress: null,
        vatRegime: 'franchise',
        vatNumber: null,
        insurerName: null,
        insuranceCoverage: null,
        mediatorName: null,
        mediatorUrl: null,
        sapDeclarationNumber: null,
        sapProfile: null,
      },
    });

    const { legalIdentity } = await service.chef('a');

    expect(legalIdentity).toMatchObject({
      name: 'Marie Dupont EI',
      siren: '443061841',
      vat: 'TVA non applicable, article 293 B du CGI',
      businessAddress: null,
    });
    expect(legalIdentity).not.toHaveProperty('missing');
  });

  it('gives each offer what the client pays, shopping fee included, before and after the tax credit', async () => {
    const { service } = vitrine({
      chefs: [chef('a')],
      offers: [
        {
          chefProfileId: 'a',
          id: 'o1',
          name: 'Escale',
          description: 'Un plat, courses faites.',
          priceCents: 5000,
          shoppingIncluded: true,
          shoppingFeeCents: 1500,
        },
      ],
    });

    const { serviceOffers } = await service.chef('a');

    expect(serviceOffers[0]).toMatchObject({
      description: 'Un plat, courses faites.',
      clientPriceCents: 6500,
      afterTaxCreditCents: 3250,
    });
  });

  it('answers 404 for a chef who is not listed', async () => {
    const { service } = vitrine({ chefs: [] });
    await expect(service.chef('nobody')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('VitrineService — GET /chefs (custom request: who covers the town)', () => {
  const nice = { postalCode: '06000', city: 'nice' };

  it('lists the online chefs whose zones cover the commune, by name', async () => {
    const { service } = vitrine({
      chefs: [
        chef('c', { displayName: 'Zoé', city: 'Nice' }),
        chef('a', {
          displayName: 'Anna',
          city: 'Antibes',
          interventionZones: [
            { regionCode: '93', scope: 'cities', cities: [{ insee: '06088' }] },
          ],
        }),
        chef('b', {
          displayName: 'Bob',
          interventionZones: [
            { regionCode: '93', scope: 'cities', cities: [{ insee: '06004' }] },
          ],
        }),
        chef('d', {
          displayName: 'Dan',
          interventionZones: [{ regionCode: '11', scope: 'region', cities: [] }],
        }),
      ],
    });

    await expect(service.covering(nice)).resolves.toEqual({
      data: [
        { id: 'a', displayName: 'Anna', city: 'Antibes' },
        { id: 'c', displayName: 'Zoé', city: 'Nice' },
      ],
    });
  });

  it('reads only what the list shows, of approved chefs who are online', async () => {
    const { prisma, service } = vitrine({});
    await service.covering(nice);

    expect(prisma.chefProfile.findMany).toHaveBeenCalledWith({
      where: { isVerified: true, isActive: true },
      select: { id: true, displayName: true, city: true, interventionZones: true },
    });
  });

  it('refuses a town the postcode does not serve: 422 ADDRESS_CITY_MISMATCH', async () => {
    const { prisma, service } = vitrine({ chefs: [chef('a')] });

    const error = await service
      .covering({ postalCode: '06000', city: 'Marseille' })
      .catch((e: unknown) => e);
    expect((error as { getResponse(): { code: string } }).getResponse().code).toBe(
      'ADDRESS_CITY_MISMATCH',
    );
    expect(prisma.chefProfile.findMany).not.toHaveBeenCalled();
  });
});
