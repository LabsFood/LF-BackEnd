import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AuditService } from '../../common/audit/audit.service';
import { Prisma } from '../../generated/prisma/client';
import { GeoService } from '../../integrations/geo.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AvailabilityService } from '../calendar/availability.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ShoppingListsService } from '../shopping-lists/shopping-lists.service';
import { UsersService } from '../users/users.service';
import { BookingsMailer } from './bookings.mailer';
import { BookingsService, HOLD_MS, REMIND_AFTER_MS } from './bookings.service';

const START = new Date('2030-03-12T08:00:00.000Z'); // 09:00 in Paris
const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError(code, { code, clientVersion: 'test' });

/** A client who answered the allergy question (Recettes lot 1): peanuts. */
const DECLARED = {
  allergies: ['peanuts'],
  customAllergies: [],
  allergiesNone: false,
  allergiesDeclaredAt: new Date('2030-03-01T10:00:00.000Z'),
};

/** A booking as the detail view reads it. */
const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'booking-1',
  reference: 'LF-2030-0001',
  status: 'pending',
  clientId: 'client-1',
  chefProfileId: 'chef-1',
  startsAt: START,
  endsAt: new Date(START.getTime() + 3 * 3_600_000),
  bookingDate: new Date('2030-03-12'),
  timeSlot: '09:00-12:00',
  persons: 4,
  addressLine: null,
  notes: null,
  shoppingByClient: false,
  priceCents: 20_000,
  extraMeals: 0,
  extraPersonsCents: 0,
  extraMealsCents: 0,
  shoppingFeeCents: 0,
  amountTtc: 20_000,
  amountAfterTax: 10_000,
  currency: 'EUR',
  arrivedAt: null,
  createdAt: new Date('2030-03-01T10:00:00.000Z'),
  client: {
    id: 'client-1',
    fullName: 'Sophie Martin',
    email: 'sophie@example.com',
    avatarUrl: null,
    clientProfile: { ...DECLARED, dietaryPreferences: ['halal'] },
  },
  chefProfile: { id: 'chef-1', displayName: 'Chef Marie', sapProfile: null },
  serviceOffer: {
    id: 'offer-1',
    name: 'Session 3 h',
    durationMinutes: 180,
    shoppingIncluded: false,
    shoppingFeeCents: 0,
  },
  formule: null,
  payments: [],
  quote: null,
  _count: { bookingMeals: 0 },
  bookingMeals: [],
  photos: [],
  reschedules: [],
  ...overrides,
});

const OFFER = {
  id: 'offer-1',
  chefProfileId: 'chef-1',
  durationMinutes: 180,
  priceCents: 20_000,
  currency: 'EUR',
  shoppingIncluded: false,
  shoppingFeeCents: 0,
  mealsIncluded: null,
  chefProfile: { userId: 'chef-user' },
};

describe('BookingsService', () => {
  let prisma: Record<string, Record<string, jest.Mock>> & { $transaction: jest.Mock };
  let users: Record<string, jest.Mock>;
  let lists: Record<string, jest.Mock>;
  let availability: { assertBookable: jest.Mock };
  let audit: { record: jest.Mock };
  let notifications: { notify: jest.Mock };
  let mailer: { holdReminder: jest.Mock };
  /** The real address check, over a stubbed geo.api.gouv.fr. */
  const geo = Object.assign(new GeoService(), {
    communesByPostcode: jest.fn(async (code: string) =>
      code === '93100'
        ? [{ nom: 'Montreuil', code: '93048', codeDepartement: '93' }]
        : [],
    ),
    // The official address base knows every street but the made-up one.
    bestStreetScore: jest.fn(async (line: string) => (/azerty/i.test(line) ? null : 0.9)),
  });
  let service: BookingsService;

  beforeEach(() => {
    prisma = {
      booking: {
        findFirst: jest.fn().mockResolvedValue(row()),
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'booking-1' }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      serviceOffer: { findFirst: jest.fn().mockResolvedValue(OFFER) },
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'client-1' }) },
      conversation: { count: jest.fn().mockResolvedValue(0) },
      formule: { findFirst: jest.fn().mockResolvedValue(null) },
      meal: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      clientProfile: { findUnique: jest.fn().mockResolvedValue(DECLARED) },
      payment: { count: jest.fn().mockResolvedValue(0) },
      platformSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      commissionInvoice: { findFirst: jest.fn().mockResolvedValue(null) },
      commission: { findFirst: jest.fn().mockResolvedValue(null) },
      bookingMeal: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
        delete: jest.fn(),
        create: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn(),
    } as never;
    prisma.$transaction.mockImplementation((work: unknown) =>
      typeof work === 'function' ? work(prisma) : Promise.all(work as unknown[]),
    );
    users = {
      ensurePersistedFromClerk: jest.fn().mockResolvedValue({ id: 'client-1' }),
      findByClerkId: jest.fn().mockResolvedValue({ id: 'admin-1' }),
      chefIdentity: jest
        .fn()
        .mockResolvedValue({ userId: 'chef-user', chefProfileId: 'chef-1' }),
    };
    lists = {
      pinRecipes: jest.fn().mockResolvedValue([]),
      regenerateForBooking: jest.fn().mockResolvedValue({}),
      refreshAfterMenuChange: jest.fn().mockResolvedValue(null),
    };
    availability = { assertBookable: jest.fn().mockResolvedValue(undefined) };
    audit = { record: jest.fn() };
    notifications = { notify: jest.fn().mockResolvedValue({}) };
    mailer = { holdReminder: jest.fn() };
    const config = {
      get: jest.fn((key: string, fallback?: unknown) =>
        key === 'payments.commissionRateBps'
          ? 1500
          : key === 'payments.commissionVatRateBps'
            ? 2000
            : fallback,
      ),
    };

    service = new BookingsService(
      prisma as unknown as PrismaService,
      users as unknown as UsersService,
      lists as unknown as ShoppingListsService,
      availability as unknown as AvailabilityService,
      audit as unknown as AuditService,
      mailer as unknown as BookingsMailer,
      config as unknown as ConfigService,
      geo,
      notifications as unknown as NotificationsService,
    );
  });

  describe('listFor', () => {
    it('keeps a client to their own bookings, whatever the query says', async () => {
      await service.listFor('client', 'clerk_1', { clientId: 'someone-else' });

      const { where, orderBy } = prisma.booking.findMany.mock.calls[0][0];
      expect(where.clientId).toBe('client-1');
      expect(orderBy).toEqual([{ startsAt: 'desc' }, { id: 'desc' }]);
    });

    it('gives a batch cooker their prestations in agenda order, with what they earn', async () => {
      prisma.booking.findMany.mockResolvedValue([row()]);

      const page = await service.listFor('chef', 'clerk_1', { clientId: 'client-1' });

      const { where, orderBy } = prisma.booking.findMany.mock.calls[0][0];
      expect(where).toMatchObject({ clientId: 'client-1', chefProfileId: 'chef-1' });
      expect(orderBy).toEqual([{ startsAt: 'asc' }, { id: 'asc' }]);
      expect(page.data[0]).toMatchObject({
        client: { name: 'Sophie M.' },
        netCents: 16_400,
        commissionCents: 3_600,
        commissionEstimated: true,
      });
    });

    it('says how a booking is paid from money that came in, not an abandoned card', async () => {
      prisma.booking.findMany.mockResolvedValue([
        row({
          payments: [
            { method: 'cb', status: 'pending', amountTtc: 20_000, commission: null },
            { method: 'cesu', status: 'pending', amountTtc: 8_000, commission: null },
            { method: 'cb', status: 'succeeded', amountTtc: 2_000, commission: null },
          ],
        }),
      ]);

      const page = await service.listFor('client', 'clerk_1');

      expect(page.data[0]).toMatchObject({
        paymentMethods: ['cesu', 'cb'],
        paidCents: 2_000,
      });
    });

    it('never shows a client the commission or the diet sheet', async () => {
      const detail = await service.detailFor('client', 'clerk_1', 'booking-1');

      expect(detail).not.toHaveProperty('netCents');
      expect(detail).not.toHaveProperty('allergies');
      expect(detail).toHaveProperty('chefCesu');
    });

    it('shows the batch cooker what the client cannot eat, profile and request merged', async () => {
      prisma.booking.findFirst.mockResolvedValue(
        row({ quote: { allergies: ['arachides', 'sésame'], diet: [], offers: [] } }),
      );

      const detail = await service.detailFor('chef', 'clerk_1', 'booking-1');

      expect(detail).toMatchObject({
        allergies: ['Arachides', 'Graines de sésame'],
        diets: ['halal'],
      });
    });
  });

  describe('create', () => {
    const dto = { serviceOfferId: 'offer-1', startsAt: START };

    it('opens a pending booking priced from the offer, ending after its duration', async () => {
      await service.create('client', 'clerk_1', dto);

      expect(availability.assertBookable).toHaveBeenCalledWith(
        'chef-1',
        START,
        new Date('2030-03-12T11:00:00.000Z'),
      );
      expect(prisma.booking.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            // Numbered in the year it is made.
            reference: `LF-${new Date().getUTCFullYear()}-0001`,
            clientId: 'client-1',
            status: 'pending',
            priceCents: 20_000,
            amountTtc: 20_000,
            amountAfterTax: 10_000,
            endsAt: new Date('2030-03-12T11:00:00.000Z'),
            timeSlot: '09:00-12:00',
          }),
        }),
      );
    });

    it('keeps a street the postcode has no trace of: only a warning is logged', async () => {
      await service.create('client', 'clerk_1', {
        ...dto,
        addressPostalCode: '93100',
        addressCity: 'Montreuil',
        addressLine: '99 rue Azerty',
      });
      expect(prisma.booking.create).toHaveBeenCalledTimes(1);
    });

    it('refuses a town the postcode does not serve, creating nothing', async () => {
      await expect(
        service.create('client', 'clerk_1', {
          ...dto,
          addressPostalCode: '93100',
          addressCity: 'Marseille',
        }),
      ).rejects.toMatchObject({
        status: 422,
        response: { code: 'ADDRESS_CITY_MISMATCH', communes: ['Montreuil'] },
      });
      expect(prisma.booking.create).not.toHaveBeenCalled();
    });

    it('prices from the formule when one is chosen', async () => {
      prisma.formule.findFirst.mockResolvedValue({
        id: 'essentiel',
        priceTtc: 24_900,
        priceAfterTax: 12_450,
      });

      await service.create('client', 'clerk_1', { ...dto, formuleId: 'essentiel' });

      expect(prisma.booking.create.mock.calls[0][0].data).toMatchObject({
        formuleId: 'essentiel',
        priceCents: 24_900,
        amountAfterTax: 12_450,
      });
    });

    it('adds the shopping fee apart when the batch cooker does the shopping', async () => {
      prisma.serviceOffer.findFirst.mockResolvedValue({
        ...OFFER,
        shoppingIncluded: true,
        shoppingFeeCents: 1_500,
      });

      await service.create('client', 'clerk_1', dto);

      expect(prisma.booking.create.mock.calls[0][0].data).toMatchObject({
        priceCents: 20_000,
        shoppingFeeCents: 1_500,
        amountTtc: 21_500,
        amountAfterTax: 10_750,
      });
    });

    it('adds adults beyond what the offer covers and the extra dishes, each apart', async () => {
      await service.create('client', 'clerk_1', { ...dto, persons: 4, extraMeals: 2 });

      expect(prisma.booking.create.mock.calls[0][0].data).toMatchObject({
        priceCents: 20_000,
        extraMeals: 2,
        extraPersonsCents: 1_500,
        extraMealsCents: 1_600,
        amountTtc: 23_100,
        amountAfterTax: 11_550,
      });
    });

    it('charges no shopping fee when the client does the shopping', async () => {
      prisma.serviceOffer.findFirst.mockResolvedValue({
        ...OFFER,
        shoppingIncluded: true,
        shoppingFeeCents: 1_500,
      });

      await service.create('client', 'clerk_1', { ...dto, shoppingByClient: true });

      expect(prisma.booking.create.mock.calls[0][0].data).toMatchObject({
        shoppingFeeCents: 0,
        amountTtc: 20_000,
      });
    });

    it('takes exactly the dishes a fixed-count offer includes, creating nothing else', async () => {
      prisma.serviceOffer.findFirst.mockResolvedValue({ ...OFFER, mealsIncluded: 3 });
      prisma.meal.count.mockResolvedValue(2);

      await expect(
        service.create('client', 'clerk_1', {
          ...dto,
          meals: [{ mealId: 'meal-1' }, { mealId: 'meal-2' }],
        }),
      ).rejects.toMatchObject({
        status: 422,
        response: { code: 'MEAL_COUNT_MISMATCH', mealsIncluded: 3 },
      });
      expect(prisma.booking.create).not.toHaveBeenCalled();
    });

    it('sells no extra dish on a fixed-count offer', async () => {
      prisma.serviceOffer.findFirst.mockResolvedValue({ ...OFFER, mealsIncluded: 3 });

      await expect(
        service.create('client', 'clerk_1', { ...dto, extraMeals: 1 }),
      ).rejects.toMatchObject({ response: { code: 'EXTRA_MEALS_NOT_OFFERED' } });
      expect(prisma.booking.create).not.toHaveBeenCalled();
    });

    it('books the dishes of a fixed-count offer at the portions the client asked', async () => {
      prisma.serviceOffer.findFirst.mockResolvedValue({ ...OFFER, mealsIncluded: 2 });
      prisma.meal.count.mockResolvedValue(2);

      await service.create('client', 'clerk_1', {
        ...dto,
        meals: [
          { mealId: 'meal-1', portions: 6 },
          { mealId: 'meal-2', portions: 6 },
        ],
      });

      expect(prisma.booking.create.mock.calls[0][0].data.bookingMeals).toEqual({
        create: [
          { mealId: 'meal-1', portions: 6 },
          { mealId: 'meal-2', portions: 6 },
        ],
      });
    });

    it('pins the recipes of the dishes booked', async () => {
      prisma.meal.count.mockResolvedValue(1);

      await service.create('client', 'clerk_1', {
        ...dto,
        meals: [{ mealId: 'meal-1' }],
      });

      // Recettes lot 3 (LF-0268): in the transaction that writes the menu.
      expect(lists.pinRecipes).toHaveBeenCalledWith('booking-1', {
        db: expect.anything(),
      });
    });

    it('takes the next reference when another booking got this one first', async () => {
      prisma.booking.create
        .mockRejectedValueOnce(prismaError('P2002'))
        .mockResolvedValueOnce({ id: 'booking-1' });

      await service.create('client', 'clerk_1', dto);

      expect(prisma.booking.create.mock.calls[1][0].data.reference).toMatch(
        /^LF-\d{4}-0002$/,
      );
    });

    it('refuses a batch cooker booking themselves', async () => {
      users.ensurePersistedFromClerk.mockResolvedValue({ id: 'chef-user' });

      await expect(service.create('client', 'clerk_1', dto)).rejects.toMatchObject({
        response: { code: 'SAME_PERSON' },
      });
    });

    it('lets a batch cooker book only for a client they already know', async () => {
      await expect(
        service.create('chef', 'clerk_1', { ...dto, clientId: 'client-1' }),
      ).rejects.toMatchObject({ response: { code: 'CLIENT_NOT_FOUND' } });

      prisma.conversation.count.mockResolvedValue(1);
      await service.create('chef', 'clerk_1', { ...dto, clientId: 'client-1' });
      expect(prisma.serviceOffer.findFirst.mock.calls[1][0].where.chefProfileId).toBe(
        'chef-1',
      );
    });

    it('takes the client’s own address when the batch cooker gives none', async () => {
      prisma.conversation.count.mockResolvedValue(1);
      prisma.clientProfile.findUnique.mockResolvedValue({
        ...DECLARED,
        addressStreet: '12 rue des Lilas',
        addressCity: 'Montreuil',
        addressPostalCode: '93100',
      });

      await service.create('chef', 'clerk_1', { ...dto, clientId: 'client-1' });

      expect(prisma.booking.create.mock.calls[0][0].data).toMatchObject({
        addressLine: '12 rue des Lilas',
        addressCity: 'Montreuil',
        addressPostalCode: '93100',
      });
    });

    it('keeps the address the batch cooker gives over the client’s', async () => {
      prisma.conversation.count.mockResolvedValue(1);
      prisma.clientProfile.findUnique.mockResolvedValue({
        ...DECLARED,
        addressStreet: '12 rue des Lilas',
        addressCity: 'Montreuil',
        addressPostalCode: '93100',
      });

      await service.create('chef', 'clerk_1', {
        ...dto,
        clientId: 'client-1',
        addressLine: '1 rue Neuve',
        addressCity: 'Montreuil',
        addressPostalCode: '93100',
      });

      expect(prisma.booking.create.mock.calls[0][0].data).toMatchObject({
        addressLine: '1 rue Neuve',
      });
    });

    it('stops a batch cooker whose commission could not be collected', async () => {
      prisma.commissionInvoice.findFirst.mockResolvedValue({ invoiceNumber: 'LF-COM-1' });

      const refusal = service.create('client', 'clerk_1', dto);

      await expect(refusal).rejects.toMatchObject({
        response: { code: 'CHEF_UNAVAILABLE' },
      });
      // The client is told the cook is unavailable, never which invoice went unpaid.
      await expect(refusal).rejects.not.toThrow(/LF-COM-1/);
    });

    it('lets an admin book without the availability check, and audits it', async () => {
      await service.create('admin', 'clerk_1', { ...dto, clientId: 'client-1' });

      expect(availability.assertBookable).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'booking.created', actorUserId: 'admin-1' }),
      );
    });
  });

  describe('booking boxes (CGV V1)', () => {
    /** 1 December 2026: the CGV V1 are in force. */
    const V1_NOW = new Date('2026-12-01T09:00:00.000Z');
    const dto = { serviceOfferId: 'offer-1', startsAt: START };
    const boxes = { version: '1.0', cgv: true };

    beforeEach(() => {
      jest.useFakeTimers({
        now: V1_NOW,
        doNotFake: [
          'nextTick',
          'setImmediate',
          'setTimeout',
          'setInterval',
          'queueMicrotask',
        ],
      });
    });
    afterEach(() => jest.useRealTimers());

    it('refuses a client booking sent without them, creating nothing', async () => {
      await expect(service.create('client', 'clerk_1', dto)).rejects.toMatchObject({
        status: 422,
        response: { code: 'CONTRACT_CONSENT_REQUIRED', missing: ['CGV'], version: '1.0' },
      });
      expect(prisma.booking.create).not.toHaveBeenCalled();
    });

    it('asks for the mandate when the batch cooker shops, and for early execution inside 14 days', async () => {
      prisma.serviceOffer.findFirst.mockResolvedValue({
        ...OFFER,
        shoppingIncluded: true,
      });
      const soon = new Date('2026-12-10T09:00:00.000Z');

      await expect(
        service.create('client', 'clerk_1', { ...dto, startsAt: soon, consents: boxes }),
      ).rejects.toMatchObject({
        response: { missing: ['DEBOURS_MANDATE', 'EARLY_EXECUTION'] },
      });
    });

    it('stamps the boxes on the booking and keeps the proof in the audit', async () => {
      await service.create('client', 'clerk_1', { ...dto, consents: boxes });

      expect(prisma.booking.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contractVersion: '1.0',
            cgvAcceptedAt: V1_NOW,
            deboursMandateAcceptedAt: null,
            earlyExecutionRequestedAt: null,
          }),
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: 'client',
          action: 'booking.consents',
          subjectId: 'booking-1',
          metadata: expect.objectContaining({
            version: '1.0',
            texts: { cgv: expect.stringContaining('Conditions Générales de Vente') },
          }),
        }),
      );
    });

    it('lets a batch cooker book for a client: the client ticks the boxes before paying', async () => {
      prisma.conversation.count.mockResolvedValue(1);
      await service.create('chef', 'clerk_1', {
        ...dto,
        clientId: 'client-1',
        consents: boxes,
      });

      expect(prisma.booking.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ contractVersion: null, cgvAcceptedAt: null }),
        }),
      );
    });

    describe('consent', () => {
      const pending = {
        status: 'pending',
        startsAt: START,
        createdAt: V1_NOW,
        shoppingByClient: false,
        contractVersion: null,
        cgvAcceptedAt: null,
        deboursMandateAcceptedAt: null,
        earlyExecutionRequestedAt: null,
        serviceOffer: { shoppingIncluded: true },
      };

      it('stamps the boxes a pending booking still lacks', async () => {
        prisma.booking.findFirst.mockResolvedValueOnce(pending);

        await service.consent('clerk_1', 'booking-1', { ...boxes, deboursMandate: true });

        expect(prisma.booking.update).toHaveBeenCalledWith({
          where: { id: 'booking-1', status: 'pending' },
          data: {
            contractVersion: '1.0',
            cgvAcceptedAt: V1_NOW,
            deboursMandateAcceptedAt: V1_NOW,
            earlyExecutionRequestedAt: null,
          },
        });
      });

      it('refuses while a box the booking needs is still missing', async () => {
        prisma.booking.findFirst.mockResolvedValueOnce(pending);

        await expect(
          service.consent('clerk_1', 'booking-1', boxes),
        ).rejects.toMatchObject({
          status: 422,
          response: { missing: ['DEBOURS_MANDATE'] },
        });
        expect(prisma.booking.update).not.toHaveBeenCalled();
      });

      it('takes boxes on a pending booking only', async () => {
        prisma.booking.findFirst.mockResolvedValueOnce({
          ...pending,
          status: 'confirmed',
        });

        await expect(
          service.consent('clerk_1', 'booking-1', boxes),
        ).rejects.toMatchObject({
          response: { code: 'BOOKING_LOCKED' },
        });
      });
    });
  });

  describe('update', () => {
    it('locks the details once the booking is no longer pending', async () => {
      prisma.booking.findFirst.mockResolvedValue(row({ status: 'confirmed' }));

      await expect(
        service.update('client', 'clerk_1', 'booking-1', { notes: 'Digicode 12' }),
      ).rejects.toMatchObject({ response: { code: 'BOOKING_LOCKED' } });
    });

    it('checks a changed town against the postcode on file', async () => {
      prisma.booking.findFirst.mockResolvedValue(
        row({ addressPostalCode: '93100', addressCity: 'Montreuil' }),
      );

      await expect(
        service.update('client', 'clerk_1', 'booking-1', { addressCity: 'Marseille' }),
      ).rejects.toMatchObject({ response: { code: 'ADDRESS_CITY_MISMATCH' } });
      expect(prisma.booking.update).not.toHaveBeenCalled();
    });

    it('keeps a changed menu to the count of a fixed-count offer', async () => {
      prisma.booking.findFirst.mockResolvedValue(
        row({ serviceOffer: { ...row().serviceOffer, mealsIncluded: 3 } }),
      );

      await expect(
        service.update('client', 'clerk_1', 'booking-1', {
          meals: [{ mealId: 'meal-1' }],
        }),
      ).rejects.toMatchObject({ response: { code: 'MEAL_COUNT_MISMATCH' } });
      expect(prisma.booking.update).not.toHaveBeenCalled();
    });

    it('never lets a client confirm: paying does', async () => {
      await expect(
        service.update('client', 'clerk_1', 'booking-1', { status: 'confirmed' }),
      ).rejects.toMatchObject({ response: { code: 'INVALID_TRANSITION' } });
    });

    it('refuses to cancel what was paid: Lab’s Food does it', async () => {
      prisma.payment.count.mockResolvedValue(1);

      await expect(
        service.update('client', 'clerk_1', 'booking-1', { status: 'cancelled' }),
      ).rejects.toMatchObject({ response: { code: 'BOOKING_PAID' } });
    });

    it('reprices when the client adds adults, keeping the base price', async () => {
      prisma.booking.findFirst.mockResolvedValue(row());

      await service.update('client', 'clerk_1', 'booking-1', { persons: 5 });

      expect(prisma.booking.update.mock.calls[0][0].data).toMatchObject({
        persons: 5,
        extraPersonsCents: 3_000,
        extraMealsCents: 0,
        amountTtc: 23_000,
        amountAfterTax: 11_500,
      });
    });

    it('reprices when the client changes the extra dishes', async () => {
      await service.update('client', 'clerk_1', 'booking-1', { extraMeals: 1 });

      expect(prisma.booking.update.mock.calls[0][0].data).toMatchObject({
        extraMeals: 1,
        extraMealsCents: 800,
        extraPersonsCents: 0,
        amountTtc: 20_800,
        amountAfterTax: 10_400,
      });
    });

    it('drops the shopping fee when the client takes the shopping on', async () => {
      prisma.booking.findFirst.mockResolvedValue(
        row({
          shoppingFeeCents: 1_500,
          amountTtc: 21_500,
          amountAfterTax: 10_750,
          serviceOffer: {
            ...row().serviceOffer,
            shoppingIncluded: true,
            shoppingFeeCents: 1_500,
          },
        }),
      );

      await service.update('client', 'clerk_1', 'booking-1', { shoppingByClient: true });

      expect(prisma.booking.update.mock.calls[0][0].data).toMatchObject({
        shoppingByClient: true,
        shoppingFeeCents: 0,
        amountTtc: 20_000,
        amountAfterTax: 10_000,
      });
    });

    it('cancels an unpaid booking', async () => {
      await service.update('client', 'clerk_1', 'booking-1', { status: 'cancelled' });

      expect(prisma.booking.update).toHaveBeenCalledWith({
        where: { id: 'booking-1', status: 'pending' },
        data: expect.objectContaining({ status: 'cancelled' }),
      });
    });

    it('reports a change made meanwhile instead of overwriting it', async () => {
      prisma.booking.update.mockRejectedValue(prismaError('P2025'));

      await expect(
        service.update('client', 'clerk_1', 'booking-1', { status: 'cancelled' }),
      ).rejects.toMatchObject({ response: { code: 'CHANGED_MEANWHILE' } });
    });

    it('records the arrival on the first move to cooking', async () => {
      jest.useFakeTimers().setSystemTime(new Date(START.getTime() - 60 * 60 * 1000));
      prisma.booking.findFirst.mockResolvedValue(row({ status: 'confirmed' }));

      await service.update('chef', 'clerk_1', 'booking-1', { status: 'cooking' });

      expect(prisma.booking.update.mock.calls[0][0].data).toMatchObject({
        status: 'cooking',
        arrivedAt: new Date(START.getTime() - 60 * 60 * 1000),
      });
      jest.useRealTimers();
    });

    it('refuses an arrival recorded too early', async () => {
      jest.useFakeTimers().setSystemTime(new Date(START.getTime() - 3 * 60 * 60 * 1000));
      prisma.booking.findFirst.mockResolvedValue(row({ status: 'confirmed' }));

      await expect(
        service.update('chef', 'clerk_1', 'booking-1', { status: 'cooking' }),
      ).rejects.toMatchObject({ response: { code: 'TOO_EARLY' } });
      jest.useRealTimers();
    });

    it('checks a new time against the batch cooker’s availability, this booking aside', async () => {
      const later = new Date(START.getTime() + 24 * 3_600_000);

      await service.update('client', 'clerk_1', 'booking-1', { startsAt: later });

      expect(availability.assertBookable).toHaveBeenCalledWith(
        'chef-1',
        later,
        new Date(later.getTime() + 3 * 3_600_000),
        'booking-1',
      );
    });
  });

  describe('the menu freezes 72 hours before (Recettes lot 3, LF-0269)', () => {
    const soon = () => row({ startsAt: new Date(Date.now() + 48 * 3_600_000) });

    beforeEach(() => {
      prisma.meal.count.mockResolvedValue(1);
      prisma.clientProfile.findUnique.mockResolvedValue(DECLARED);
      prisma.meal.findMany.mockResolvedValue([
        { id: 'meal-2', allergens: [], allergensNone: true, allergensVerifiedAt: START },
      ]);
    });

    it('refuses the client a change of dishes, and writes nothing', async () => {
      prisma.booking.findFirst.mockResolvedValue(soon());

      await expect(
        service.update('client', 'clerk_1', 'booking-1', {
          meals: [{ mealId: 'meal-2' }],
        }),
      ).rejects.toMatchObject({
        response: { code: 'MENU_FROZEN', frozenSince: expect.any(Date) },
      });
      expect(prisma.bookingMeal.createMany).not.toHaveBeenCalled();
    });

    it('still takes a change that leaves the dishes alone', async () => {
      prisma.booking.findFirst.mockResolvedValue(soon());

      await service.update('client', 'clerk_1', 'booking-1', { notes: 'Digicode 12' });

      expect(prisma.booking.update).toHaveBeenCalled();
    });

    it('lets an admin change a frozen menu, pins it and records the override', async () => {
      prisma.booking.findFirst.mockResolvedValue(soon());

      await service.update('admin', 'clerk_1', 'booking-1', {
        meals: [{ mealId: 'meal-2' }],
      });

      expect(prisma.bookingMeal.createMany).toHaveBeenCalled();
      expect(lists.pinRecipes).toHaveBeenCalledWith('booking-1', {
        db: expect.anything(),
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'booking.updated',
          metadata: expect.objectContaining({ menuFrozenOverride: true }),
        }),
      );
    });
  });

  describe('the list follows a change of dishes (Recettes lot 4, LF-0283)', () => {
    beforeEach(() => {
      prisma.meal.count.mockResolvedValue(1);
      prisma.clientProfile.findUnique.mockResolvedValue(DECLARED);
      prisma.meal.findMany.mockResolvedValue([
        { id: 'meal-2', allergens: [], allergensNone: true, allergensVerifiedAt: START },
      ]);
    });

    it('tells the client when a list already sent went out again', async () => {
      lists.refreshAfterMenuChange.mockResolvedValue(2);

      await service.update('client', 'clerk_1', 'booking-1', {
        meals: [{ mealId: 'meal-2' }],
      });

      expect(notifications.notify).toHaveBeenCalledWith(
        'client-1',
        'shopping_list.updated',
        {
          type: 'booking',
          id: 'booking-1',
        },
      );
    });

    it('tells nobody when no list had been sent', async () => {
      await service.update('client', 'clerk_1', 'booking-1', {
        meals: [{ mealId: 'meal-2' }],
      });

      expect(lists.refreshAfterMenuChange).toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    });
  });

  describe('the conservation sheet (Recettes lot 3, LF-0272)', () => {
    it('tells the client once the chef marks the dishes delivered', async () => {
      prisma.booking.findFirst.mockResolvedValue(
        row({ status: 'cooking', startsAt: new Date(Date.now() - 3 * 3_600_000) }),
      );

      await service.update('chef', 'clerk_1', 'booking-1', { status: 'delivered' });

      expect(notifications.notify).toHaveBeenCalledWith(
        'client-1',
        'conservation.ready',
        {
          type: 'booking',
          id: 'booking-1',
        },
      );
    });

    it('tells nobody for another move', async () => {
      prisma.booking.findFirst.mockResolvedValue(row({ status: 'pending' }));

      await service.update('client', 'clerk_1', 'booking-1', { status: 'cancelled' });

      expect(notifications.notify).not.toHaveBeenCalled();
    });
  });

  describe('express dishes of a custom prestation (15/11)', () => {
    beforeEach(() => {
      prisma.booking.findFirst.mockResolvedValue(
        row({ status: 'cooking', startsAt: new Date(Date.now() - 3 * 3_600_000) }),
      );
    });

    it('asks the batch cooker to keep or drop them once delivered', async () => {
      prisma.bookingMeal.count.mockResolvedValue(1);
      prisma.booking.findUnique.mockResolvedValue({
        chefProfile: { userId: 'chef-user-1' },
      });

      await service.update('chef', 'clerk_1', 'booking-1', { status: 'delivered' });

      expect(prisma.bookingMeal.count).toHaveBeenCalledWith({
        where: {
          bookingId: 'booking-1',
          meal: { expressQuoteId: { not: null }, expressDecision: null },
        },
      });
      expect(notifications.notify).toHaveBeenCalledWith(
        'chef-user-1',
        'express_dish.decide',
        {
          type: 'booking',
          id: 'booking-1',
        },
      );
    });

    it('asks nothing when no express dish waits', async () => {
      await service.update('chef', 'clerk_1', 'booking-1', { status: 'delivered' });

      expect(notifications.notify).not.toHaveBeenCalledWith(
        expect.anything(),
        'express_dish.decide',
        expect.anything(),
      );
    });
  });

  describe('expireUnpaid', () => {
    const NOW = new Date('2030-03-10T12:00:00.000Z');

    it('reminds both sides once at 48 h', async () => {
      prisma.booking.findMany
        .mockResolvedValueOnce([
          {
            ...row(),
            createdAt: new Date(NOW.getTime() - REMIND_AFTER_MS),
            chefProfile: {
              displayName: 'Chef Marie',
              user: { email: 'marie@example.com', fullName: 'Marie D.' },
            },
          },
        ])
        .mockResolvedValueOnce([]);

      const result = await service.expireUnpaid(NOW);

      expect(result).toEqual({ reminded: 1, expired: 0 });
      expect(mailer.holdReminder).toHaveBeenCalledWith(
        expect.objectContaining({
          freedAt: new Date(NOW.getTime() - REMIND_AFTER_MS + HOLD_MS),
        }),
      );
    });

    it('sends nothing when another instance claimed the reminder', async () => {
      prisma.booking.findMany.mockResolvedValueOnce([row()]).mockResolvedValueOnce([]);
      prisma.booking.updateMany.mockResolvedValue({ count: 0 });

      await service.expireUnpaid(NOW);

      expect(mailer.holdReminder).not.toHaveBeenCalled();
    });

    it('cancels at 72 h, only what is still unpaid', async () => {
      prisma.booking.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'booking-1' }, { id: 'booking-2' }]);
      // booking-2 was paid between the read and the write.
      prisma.booking.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      const result = await service.expireUnpaid(NOW);

      expect(result).toEqual({ reminded: 0, expired: 1 });
      expect(prisma.booking.updateMany.mock.calls[0][0].where).toMatchObject({
        id: 'booking-1',
        status: 'pending',
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'booking.expired', subjectId: 'booking-1' }),
      );
    });
  });

  describe('allergies (Recettes lot 1)', () => {
    const withMeals = {
      serviceOfferId: 'offer-1',
      startsAt: START,
      meals: [{ mealId: 'meal-1' }],
    };
    const dish = (id: string, allergens: string[]) => ({
      id,
      allergens,
      allergensNone: false,
      allergensVerifiedAt: START,
    });
    const line = (id: string, allergens: string[]) => ({
      mealId: id,
      portions: 6,
      recipeVersion: null,
      meal: { ...dish(id, allergens), name: 'Curry' },
    });

    beforeEach(() => prisma.meal.count.mockResolvedValue(1));

    it('refuses a menu while the client never declared their allergies', async () => {
      prisma.clientProfile.findUnique.mockResolvedValue({
        ...DECLARED,
        allergiesDeclaredAt: null,
      });
      prisma.meal.findMany.mockResolvedValue([
        { id: 'meal-1', allergens: [], allergensNone: true, allergensVerifiedAt: START },
      ]);

      await expect(service.create('client', 'clerk_1', withMeals)).rejects.toMatchObject({
        response: { code: 'ALLERGIES_NOT_DECLARED' },
      });
      expect(prisma.booking.create).not.toHaveBeenCalled();
    });

    it('sizes a dish for the household when no portions are given, a child as half', async () => {
      prisma.clientProfile.findUnique.mockResolvedValue({
        ...DECLARED,
        householdAdults: 2,
        householdKids: 1,
      });
      prisma.meal.findMany.mockResolvedValue([dish('meal-1', ['milk'])]);
      prisma.booking.create.mockRejectedValue(new Error('stop after the write'));

      await service.create('client', 'clerk_1', withMeals).catch(() => undefined);

      expect(prisma.booking.create.mock.calls[0][0].data.bookingMeals).toEqual({
        create: [{ mealId: 'meal-1', portions: 2.5 }],
      });
    });

    it('refuses a dish holding a declared allergen, for an admin too', async () => {
      prisma.meal.findMany.mockResolvedValue([dish('meal-1', ['peanuts'])]);

      await expect(
        service.create('admin', 'clerk_1', {
          ...withMeals,
          clientId: 'client-1',
        } as never),
      ).rejects.toMatchObject({
        response: {
          code: 'ALLERGEN_CONFLICT',
          conflicts: [{ mealId: 'meal-1', allergens: ['peanuts'] }],
        },
      });
    });

    it('flags a dish in conflict on the detail, and only the reason on a row', async () => {
      prisma.booking.findFirst.mockResolvedValue(
        row({ bookingMeals: [line('meal-1', ['peanuts'])] }),
      );
      prisma.booking.findMany.mockResolvedValue([
        row({ bookingMeals: [line('meal-1', ['peanuts'])] }),
      ]);

      const detail = await service.detailFor('client', 'clerk_1', 'booking-1');
      const page = await service.listFor('client', 'clerk_1');

      expect(detail).toMatchObject({
        allergyCheck: 'unverified',
        allergyCheckReasons: ['ALLERGEN_CONFLICT'],
        allergyConflicts: [{ mealId: 'meal-1', allergens: ['peanuts'] }],
      });
      expect(page.data[0]).toMatchObject({ allergyCheckReasons: ['ALLERGEN_CONFLICT'] });
      expect(JSON.stringify(page.data[0])).not.toContain('peanuts');
    });

    it('swaps a dish in conflict for a safe one, on a confirmed booking', async () => {
      prisma.booking.findFirst
        .mockResolvedValueOnce({
          status: 'confirmed',
          clientId: 'client-1',
          chefProfileId: 'chef-1',
          quote: null,
          bookingMeals: [{ portions: 6, meal: dish('meal-1', ['peanuts']) }],
        })
        .mockResolvedValue(row({ status: 'confirmed' }));
      prisma.meal.findMany.mockResolvedValue([dish('meal-2', ['milk'])]);

      await service.replaceConflictingMeal('client', 'clerk_1', 'booking-1', {
        from: 'meal-1',
        to: 'meal-2',
      });

      expect(prisma.bookingMeal.delete).toHaveBeenCalledWith({
        where: { bookingId_mealId: { bookingId: 'booking-1', mealId: 'meal-1' } },
      });
      expect(prisma.bookingMeal.create).toHaveBeenCalledWith({
        data: { bookingId: 'booking-1', mealId: 'meal-2', portions: 6 },
      });
      expect(lists.refreshAfterMenuChange).toHaveBeenCalledWith(
        'booking-1',
        expect.any(Date),
      );
    });

    it('refuses to swap a dish that is not in conflict, or for an unsafe one', async () => {
      const booking = {
        status: 'confirmed',
        clientId: 'client-1',
        chefProfileId: 'chef-1',
        quote: null,
        bookingMeals: [
          { portions: 4, meal: dish('meal-1', ['milk']) },
          { portions: 4, meal: dish('meal-3', ['peanuts']) },
        ],
      };
      prisma.booking.findFirst.mockResolvedValue(booking);
      prisma.meal.findMany.mockResolvedValue([dish('meal-2', ['peanuts'])]);

      await expect(
        service.replaceConflictingMeal('chef', 'clerk_1', 'booking-1', {
          from: 'meal-1',
          to: 'meal-2',
        }),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_FAILED' } });
      await expect(
        service.replaceConflictingMeal('chef', 'clerk_1', 'booking-1', {
          from: 'meal-3',
          to: 'meal-2',
        }),
      ).rejects.toMatchObject({ response: { code: 'ALLERGEN_CONFLICT' } });
      expect(prisma.bookingMeal.delete).not.toHaveBeenCalled();
    });
  });

  describe('logs', () => {
    const PERSONAL = [
      'sophie@example.com',
      'marie@example.com',
      'Marie D.',
      '12 rue des Lilas',
      'Digicode 4521',
    ];

    it('carry ids and counts, never a name, email, address or note', async () => {
      const calls: unknown[][] = [];
      for (const level of ['log', 'warn', 'error', 'debug'] as const) {
        jest
          .spyOn(Logger.prototype, level)
          .mockImplementation((...args: unknown[]) => void calls.push(args));
      }
      prisma.meal.count.mockResolvedValue(1);

      await service.create('client', 'clerk_1', {
        serviceOfferId: 'offer-1',
        startsAt: START,
        addressLine: '12 rue des Lilas',
        notes: 'Digicode 4521',
        meals: [{ mealId: 'meal-1' }],
      } as never);
      await service.update('client', 'clerk_1', 'booking-1', {
        addressLine: '12 rue des Lilas',
        notes: 'Digicode 4521',
      });
      prisma.booking.findMany
        .mockResolvedValueOnce([
          {
            ...row(),
            client: { email: 'sophie@example.com', fullName: 'Sophie M.' },
            chefProfile: {
              displayName: 'Chef Marie',
              user: { email: 'marie@example.com', fullName: 'Marie D.' },
            },
          },
        ])
        .mockResolvedValueOnce([{ id: 'booking-2' }]);
      await service.expireUnpaid(new Date('2030-03-10T12:00:00.000Z'));

      const events = calls.map(([first]) => (first as { event?: string }).event);
      expect(events).toEqual(
        expect.arrayContaining([
          'booking.created',
          'booking.updated',
          'booking.hold_reminded',
          'booking.expired',
          'job.unpaid_holds',
        ]),
      );
      const written = JSON.stringify(calls);
      for (const value of PERSONAL) expect(written).not.toContain(value);
      jest.restoreAllMocks();
    });
  });
});
