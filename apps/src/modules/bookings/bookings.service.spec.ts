import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { BookingsService } from './bookings.service';

describe('BookingsService', () => {
  const findFirst = jest.fn().mockResolvedValue(null);
  const findUnique = jest.fn().mockResolvedValue(null);
  const findChef = jest.fn();
  const prisma = {
    booking: { findFirst, findUnique },
    chefProfile: { findUnique: findChef },
  } as unknown as PrismaService;
  const users = {
    ensurePersistedFromClerk: jest.fn().mockResolvedValue({ id: 'client-1' }),
  } as unknown as UsersService;
  const service = new BookingsService(prisma, users);

  it('never hands the recipe to the client before the prestation (FLOW-02 §8)', async () => {
    await service.getMyBookingDetail('clerk_1', 'booking-1');

    const { where, include } = findFirst.mock.calls[0][0];
    expect(where).toEqual({ id: 'booking-1', clientId: 'client-1' });
    expect(include.bookingMeals).toEqual({
      include: {
        meal: {
          omit: { ingredients: true, steps: true, reheating: true, storage: true },
        },
      },
    });
  });

  describe('assertNotOwnChef — nobody books themselves', () => {
    it('refuses the caller’s own batch cooker page', async () => {
      findChef.mockResolvedValue({ userId: 'client-1' });

      await expect(service.assertNotOwnChef('clerk_1', 'chef-1')).rejects.toMatchObject({
        status: 409,
        response: { code: 'SAME_PERSON' },
      });
      expect(findChef).toHaveBeenCalledWith({
        where: { id: 'chef-1' },
        select: { userId: true },
      });
    });

    it('lets anyone else’s page through', async () => {
      findChef.mockResolvedValue({ userId: 'someone-else' });
      await expect(
        service.assertNotOwnChef('clerk_1', 'chef-2'),
      ).resolves.toBeUndefined();
    });

    it('lets an unknown page through, for creation to answer 404', async () => {
      findChef.mockResolvedValue(null);
      await expect(
        service.assertNotOwnChef('clerk_1', 'chef-3'),
      ).resolves.toBeUndefined();
    });
  });

  it('keeps the full recipe for admins', async () => {
    await service.getAdminBookingDetail('booking-1');

    const { include } = findUnique.mock.calls[0][0];
    expect(include.bookingMeals).toEqual({ include: { meal: true } });
  });
});
