import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { ServiceOffersService } from './service-offers.service';

const ROW = {
  id: 'offer-1',
  name: 'Session 4 heures',
  description: null,
  durationMinutes: 240,
  priceCents: 18000,
  currency: 'EUR',
  shoppingIncluded: true,
  shoppingFeeCents: 1500,
  isActive: true,
};

describe('ServiceOffersService', () => {
  let prisma: Record<string, Record<string, jest.Mock>>;
  let service: ServiceOffersService;

  beforeEach(() => {
    prisma = {
      serviceOffer: {
        findMany: jest.fn().mockResolvedValue([ROW]),
        findFirst: jest.fn().mockResolvedValue(ROW),
        create: jest.fn().mockResolvedValue(ROW),
        update: jest.fn().mockResolvedValue(ROW),
        delete: jest.fn(),
      },
      booking: { count: jest.fn().mockResolvedValue(0) },
      platformSetting: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const users = {
      chefIdentity: jest
        .fn()
        .mockResolvedValue({ userId: 'u1', chefProfileId: 'chef-1' }),
    };
    service = new ServiceOffersService(
      prisma as unknown as PrismaService,
      users as unknown as UsersService,
    );
  });

  it('lists with `active` in place of `isActive`', async () => {
    const [offer] = await service.list('clerk-1');
    expect(offer).toMatchObject({ id: 'offer-1', active: true });
    expect(offer).not.toHaveProperty('isActive');
  });

  it('lists every batch cooker’s offers for the admin, with the cook, never the custom-quote line', async () => {
    prisma.serviceOffer.findMany.mockResolvedValue([
      {
        ...ROW,
        chefProfile: { id: 'chef-1', displayName: 'Chef Marie D.' },
        _count: { bookings: 3 },
      },
    ]);

    const [offer] = await service.listAll();

    expect(prisma.serviceOffer.findMany.mock.calls[0][0].where).toEqual({
      name: { not: 'Prestation sur-mesure' },
    });
    expect(offer).toEqual({
      id: 'offer-1',
      name: 'Session 4 heures',
      description: null,
      durationMinutes: 240,
      priceCents: 18000,
      currency: 'EUR',
      shoppingIncluded: true,
      shoppingFeeCents: 1500,
      active: true,
      chef: { id: 'chef-1', displayName: 'Chef Marie D.' },
      bookingsCount: 3,
    });
  });

  it('creates an offer on the caller’s own page', async () => {
    await service.create('clerk-1', {
      name: ' Session 4 heures ',
      durationMinutes: 240,
      priceCents: 18000,
      shoppingIncluded: true,
      shoppingFeeCents: 1500,
      mealsIncluded: 3,
    });
    expect(prisma.serviceOffer.create.mock.calls[0][0].data).toMatchObject({
      chefProfileId: 'chef-1',
      name: 'Session 4 heures',
      shoppingFeeCents: 1500,
      isActive: true,
    });
  });

  it('blocks the default slot when the chef gives no duration', async () => {
    await service.create('clerk-1', { name: 'Douceur', priceCents: 9000, mealsIncluded: 3 });
    expect(prisma.serviceOffer.create.mock.calls[0][0].data).toMatchObject({
      durationMinutes: 240,
      mealsIncluded: 3,
    });
  });

  it('refuses a shopping fee without shopping', async () => {
    await expect(
      service.create('clerk-1', {
        name: 'x',
        durationMinutes: 60,
        priceCents: 100,
        shoppingFeeCents: 500,
        mealsIncluded: 3,
      }),
    ).rejects.toMatchObject({ response: { code: 'SHOPPING_FEE_WITHOUT_SHOPPING' } });
    expect(prisma.serviceOffer.create).not.toHaveBeenCalled();
  });

  it('refuses the reserved custom-quote name', async () => {
    await expect(
      service.create('clerk-1', {
        name: 'Prestation sur-mesure',
        durationMinutes: 60,
        priceCents: 100,
        mealsIncluded: 3,
      }),
    ).rejects.toMatchObject({ response: { code: 'OFFER_NAME_INVALID' } });
  });

  it('resets the fee when shopping is switched off', async () => {
    await service.update('clerk-1', 'offer-1', { shoppingIncluded: false });
    expect(prisma.serviceOffer.update.mock.calls[0][0].data).toMatchObject({
      shoppingIncluded: false,
      shoppingFeeCents: 0,
    });
  });

  it('refuses a fee raise on an offer without shopping', async () => {
    prisma.serviceOffer.findFirst.mockResolvedValue({
      ...ROW,
      shoppingIncluded: false,
      shoppingFeeCents: 0,
    });
    await expect(
      service.update('clerk-1', 'offer-1', { shoppingFeeCents: 200 }),
    ).rejects.toMatchObject({ response: { code: 'SHOPPING_FEE_WITHOUT_SHOPPING' } });
  });

  it('404s on someone else’s offer', async () => {
    prisma.serviceOffer.findFirst.mockResolvedValue(null);
    await expect(
      service.update('clerk-1', 'offer-9', { priceCents: 1 }),
    ).rejects.toMatchObject({
      response: { code: 'OFFER_NOT_FOUND' },
    });
  });

  it('deletes a never-booked offer, refuses a booked one', async () => {
    await service.remove('clerk-1', 'offer-1');
    expect(prisma.serviceOffer.delete).toHaveBeenCalledWith({ where: { id: 'offer-1' } });

    prisma.booking.count.mockResolvedValue(2);
    await expect(service.remove('clerk-1', 'offer-1')).rejects.toMatchObject({
      response: { code: 'OFFER_IN_USE' },
    });
    expect(prisma.serviceOffer.delete).toHaveBeenCalledTimes(1);
  });

  it('prices a booking as POST /me/bookings will, line by line', async () => {
    await expect(
      service.price('offer-1', { persons: 4, extraMeals: 2, shoppingByClient: false }),
    ).resolves.toMatchObject({
      priceCents: 18000,
      extraPersonsCents: 1500,
      extraMealsCents: 1600,
      shoppingFeeCents: 1500,
      amountTtc: 22600,
      amountAfterTax: 11300,
      rules: { includedPersons: 3, extraMealCents: 800 },
    });
    // Only an active offer of a listed batch cooker is priced.
    expect(prisma.serviceOffer.findFirst.mock.calls[0][0].where).toMatchObject({
      id: 'offer-1',
      isActive: true,
      chefProfile: { isActive: true, isVerified: true },
    });
  });

  it('404s an offer nobody can book', async () => {
    prisma.serviceOffer.findFirst.mockResolvedValue(null);
    await expect(service.price('offer-9', {})).rejects.toMatchObject({
      response: { code: 'OFFER_NOT_FOUND' },
    });
  });
});
