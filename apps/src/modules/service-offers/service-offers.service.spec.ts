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

  it('creates an offer on the caller’s own page', async () => {
    await service.create('clerk-1', {
      name: ' Session 4 heures ',
      durationMinutes: 240,
      priceCents: 18000,
      shoppingIncluded: true,
      shoppingFeeCents: 1500,
    });
    expect(prisma.serviceOffer.create.mock.calls[0][0].data).toMatchObject({
      chefProfileId: 'chef-1',
      name: 'Session 4 heures',
      shoppingFeeCents: 1500,
      isActive: true,
    });
  });

  it('refuses a shopping fee without shopping', async () => {
    await expect(
      service.create('clerk-1', {
        name: 'x',
        durationMinutes: 60,
        priceCents: 100,
        shoppingFeeCents: 500,
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
});
