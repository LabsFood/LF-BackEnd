import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { BookingsService } from './bookings.service';

describe('BookingsService', () => {
  const findFirst = jest.fn().mockResolvedValue(null);
  const findUnique = jest.fn().mockResolvedValue(null);
  const prisma = { booking: { findFirst, findUnique } } as unknown as PrismaService;
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

  it('keeps the full recipe for admins', async () => {
    await service.getAdminBookingDetail('booking-1');

    const { include } = findUnique.mock.calls[0][0];
    expect(include.bookingMeals).toEqual({ include: { meal: true } });
  });
});
