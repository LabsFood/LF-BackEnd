import { ConfigService } from '@nestjs/config';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MessagingService } from '../messaging/services/messaging.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { ShoppingListsService } from '../shopping-lists/shopping-lists.service';
import { QuoteOffersService } from './quote-offers.service';
import { QuotesMailer } from './quotes.mailer';
import { QuotesService } from './quotes.service';

/** 1 December 2026: the CGV V1 are in force. */
const NOW = new Date('2026-12-01T09:00:00.000Z');

const OFFER = {
  id: 'offer-1',
  status: 'sent',
  chefProfileId: 'chef-1',
  validUntil: new Date('2026-12-08T09:00:00.000Z'),
  proposedDate: null,
  proposedTimeSlot: null,
  clientPriceCents: 18_000,
  afterTaxCreditCents: 9_000,
  dishes: [] as { meal: { id: string } }[],
};

const quote = (desiredDate: string, offer = OFFER) => ({
  id: 'quote-1',
  reference: 'DEM-2026-0001',
  clientId: 'client-1',
  desiredDate: new Date(`${desiredDate}T00:00:00.000Z`),
  timeSlot: 'morning',
  persons: 4,
  addressLine: '12 rue des Lilas',
  addressPostalCode: '93100',
  addressCity: 'Montreuil',
  brief: null,
  offers: [offer],
});

describe('QuoteOffersService.accept — booking boxes (CGV V1)', () => {
  let tx: Record<string, Record<string, jest.Mock>>;
  let quotes: Record<string, jest.Mock>;
  let audit: { record: jest.Mock };
  let lists: { pinRecipes: jest.Mock };
  let service: QuoteOffersService;

  beforeEach(() => {
    jest.useFakeTimers({
      now: NOW,
      doNotFake: [
        'nextTick',
        'setImmediate',
        'setTimeout',
        'setInterval',
        'queueMicrotask',
      ],
    });
    tx = {
      quoteOffer: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      serviceOffer: {
        findFirst: jest.fn().mockResolvedValue({ id: 'custom-1' }),
        create: jest.fn(),
      },
      booking: { create: jest.fn().mockResolvedValue({ id: 'booking-1' }) },
      bookingMeal: { createMany: jest.fn() },
      quote: { update: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn((work: (db: unknown) => unknown) => work(tx)),
    };
    quotes = {
      me: jest.fn().mockResolvedValue({ id: 'client-1' }),
      loadForClient: jest.fn().mockResolvedValue(quote('2027-01-20')),
      load: jest.fn().mockResolvedValue({}),
      view: jest.fn().mockReturnValue({}),
    };
    audit = { record: jest.fn() };
    lists = { pinRecipes: jest.fn().mockResolvedValue([]) };
    service = new QuoteOffersService(
      prisma as unknown as PrismaService,
      quotes as unknown as QuotesService,
      {} as PlatformSettingsService,
      {} as MessagingService,
      {} as QuotesMailer,
      audit as unknown as AuditService,
      { get: jest.fn() } as unknown as ConfigService,
      lists as unknown as ShoppingListsService,
    );
    // The conversation and the emails that follow are not under test here.
    jest
      .spyOn(
        service as unknown as { afterAcceptance: () => Promise<void> },
        'afterAcceptance',
      )
      .mockResolvedValue(undefined);
  });
  afterEach(() => jest.useRealTimers());

  it('refuses an acceptance without the CGV box, creating nothing', async () => {
    await expect(service.accept('clerk_1', 'quote-1', 'offer-1')).rejects.toMatchObject({
      status: 422,
      response: { code: 'CONTRACT_CONSENT_REQUIRED', missing: ['CGV'] },
    });
    expect(tx.booking.create).not.toHaveBeenCalled();
  });

  it('asks for early execution when the prestation falls inside the 14 days', async () => {
    quotes.loadForClient.mockResolvedValue(quote('2026-12-05'));

    await expect(
      service.accept('clerk_1', 'quote-1', 'offer-1', { version: '1.0', cgv: true }),
    ).rejects.toMatchObject({ response: { missing: ['EARLY_EXECUTION'] } });
  });

  it('concludes the contract on acceptance, with the boxes stamped and audited', async () => {
    await service.accept('clerk_1', 'quote-1', 'offer-1', { version: '1.0', cgv: true });

    expect(tx.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'confirmed',
          concludedAt: NOW,
          contractVersion: '1.0',
          cgvAcceptedAt: NOW,
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'booking.consents', subjectId: 'booking-1' }),
    );
  });

  it('marks a custom prestation as shopped by the client, with no dish when the offer has none', async () => {
    await service.accept('clerk_1', 'quote-1', 'offer-1', { version: '1.0', cgv: true });

    expect(tx.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ shoppingByClient: true }),
      }),
    );
    expect(tx.bookingMeal.createMany).not.toHaveBeenCalled();
    expect(lists.pinRecipes).not.toHaveBeenCalled();
  });

  it("makes the offer's dishes the prestation's, for the persons asked, and pins them", async () => {
    const offer = {
      ...OFFER,
      dishes: [{ meal: { id: 'dish-1' } }, { meal: { id: 'express-1' } }],
    };
    quotes.loadForClient.mockResolvedValue(quote('2027-01-20', offer));

    await service.accept('clerk_1', 'quote-1', 'offer-1', { version: '1.0', cgv: true });

    expect(tx.bookingMeal.createMany).toHaveBeenCalledWith({
      data: [
        { bookingId: 'booking-1', mealId: 'dish-1', portions: 4 },
        { bookingId: 'booking-1', mealId: 'express-1', portions: 4 },
      ],
    });
    expect(lists.pinRecipes).toHaveBeenCalledWith('booking-1', { db: tx });
  });
});

describe('QuoteOffersService.createAsChef — dishes in the offer', () => {
  const CHEF = { userId: 'chef-user-1', chefProfileId: 'chef-1' };
  let prisma: {
    commissionInvoice: { findFirst: jest.Mock };
    commission: { findFirst: jest.Mock };
    menu: { findMany: jest.Mock };
    meal: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let tx: Record<string, Record<string, jest.Mock>>;
  let service: QuoteOffersService;

  beforeEach(() => {
    tx = {
      meal: {
        create: jest
          .fn()
          .mockResolvedValueOnce({ id: 'express-1' })
          .mockResolvedValueOnce({ id: 'express-2' }),
      },
      quoteOffer: { create: jest.fn().mockResolvedValue({ id: 'offer-1' }) },
      quoteOfferDish: { createMany: jest.fn() },
      quote: { update: jest.fn() },
    };
    prisma = {
      commissionInvoice: { findFirst: jest.fn().mockResolvedValue(null) },
      commission: { findFirst: jest.fn().mockResolvedValue(null) },
      menu: { findMany: jest.fn().mockResolvedValue([]) },
      meal: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((work: (db: unknown) => unknown) => work(tx)),
    };
    const quotes = {
      chefIdentity: jest.fn().mockResolvedValue(CHEF),
      loadAssignedTo: jest
        .fn()
        .mockResolvedValue({ ...quote('2027-01-20'), status: 'submitted' }),
      assertAwaitingChef: jest.fn(),
      load: jest.fn().mockResolvedValue({}),
      view: jest.fn().mockReturnValue({}),
    };
    service = new QuoteOffersService(
      prisma as unknown as PrismaService,
      quotes as unknown as QuotesService,
      {
        commissionBps: jest.fn().mockResolvedValue(1500),
      } as unknown as PlatformSettingsService,
      {} as MessagingService,
      { offerForClient: jest.fn() } as unknown as QuotesMailer,
      { record: jest.fn() } as unknown as AuditService,
      { get: jest.fn() } as unknown as ConfigService,
      {} as ShoppingListsService,
    );
  });

  it("refuses a dish or a menu that is not the batch cooker's, published, naming each", async () => {
    prisma.meal.findMany.mockResolvedValue([{ id: 'dish-1' }]);

    await expect(
      service.createAsChef('clerk_chef', 'quote-1', {
        netCents: 17_000,
        dishIds: ['dish-1', 'dish-2'],
        menuIds: ['menu-9'],
      }),
    ).rejects.toMatchObject({
      status: 422,
      response: { code: 'OFFER_DISH_INVALID', ids: ['menu-9', 'dish-2'] },
    });
    expect(tx.quoteOffer.create).not.toHaveBeenCalled();
  });

  it("accepts only published dishes, or the request's express dishes not dropped", async () => {
    prisma.meal.findMany.mockResolvedValue([{ id: 'dish-1' }]);

    await service.createAsChef('clerk_chef', 'quote-1', {
      netCents: 17_000,
      dishIds: ['dish-1'],
    });

    expect(prisma.meal.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['dish-1'] },
        chefProfileId: 'chef-1',
        OR: [
          {
            status: 'published',
            OR: [{ expressQuoteId: null }, { expressDecision: 'kept' }],
          },
          { expressQuoteId: 'quote-1', expressDecision: null },
        ],
      },
      select: { id: true },
    });
  });

  it('writes the express dishes out of the catalogue, then the lines: menus, dishes, express', async () => {
    prisma.menu.findMany.mockResolvedValue([
      { id: 'menu-1', dishes: [{ mealId: 'dish-a' }, { mealId: 'dish-b' }] },
    ]);
    prisma.meal.findMany.mockResolvedValue([{ id: 'dish-b' }, { id: 'dish-c' }]);

    await service.createAsChef('clerk_chef', 'quote-1', {
      netCents: 17_000,
      menuIds: ['menu-1'],
      dishIds: ['dish-b', 'dish-c'],
      expressDishes: [
        { name: 'Gâteau', description: 'Chocolat', allergens: ['eggs'] },
        { name: 'Punch' },
      ],
    });

    expect(tx.meal.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        name: 'Gâteau',
        description: 'Chocolat',
        chefProfileId: 'chef-1',
        status: 'draft',
        portions: 4,
        allergens: ['eggs'],
        allergensNone: false,
        expressQuoteId: 'quote-1',
      }),
      select: { id: true },
    });
    expect(tx.quoteOfferDish.createMany).toHaveBeenCalledWith({
      data: [
        { offerId: 'offer-1', mealId: 'dish-a', menuId: 'menu-1', position: 0 },
        { offerId: 'offer-1', mealId: 'dish-b', menuId: 'menu-1', position: 1 },
        { offerId: 'offer-1', mealId: 'dish-c', menuId: null, position: 2 },
        { offerId: 'offer-1', mealId: 'express-1', menuId: null, position: 3 },
        { offerId: 'offer-1', mealId: 'express-2', menuId: null, position: 4 },
      ],
    });
  });

  it('caps an offer at 30 dishes, menus included', async () => {
    prisma.menu.findMany.mockResolvedValue([
      {
        id: 'menu-1',
        dishes: Array.from({ length: 29 }, (_, i) => ({ mealId: `d${i}` })),
      },
    ]);

    await expect(
      service.createAsChef('clerk_chef', 'quote-1', {
        netCents: 17_000,
        menuIds: ['menu-1'],
        expressDishes: [{ name: 'A' }, { name: 'B' }],
      }),
    ).rejects.toMatchObject({ response: { code: 'OFFER_TOO_MANY_DISHES' } });
  });
});
