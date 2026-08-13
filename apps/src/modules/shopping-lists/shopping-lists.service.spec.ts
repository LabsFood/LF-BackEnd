import { PrismaService } from '../../prisma/prisma.service';
import { ShoppingListsService } from './shopping-lists.service';

describe('ShoppingListsService', () => {
  it('aggregates ingredients across booking meals', async () => {
    const prisma = {
      booking: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'b1',
          bookingMeals: [
            {
              portions: 4,
              meal: {
                portions: 4,
                ingredients: [
                  { name: 'Tomato', amount: 2, unit: 'pcs', aisle: 'produce' },
                ],
              },
            },
            {
              portions: 2,
              meal: {
                portions: 2,
                ingredients: [
                  { name: 'Tomato', amount: 1, unit: 'pcs', aisle: 'produce' },
                ],
              },
            },
          ],
        }),
      },
      shoppingList: {
        upsert: jest.fn().mockResolvedValue({ id: 'sl1', bookingId: 'b1' }),
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'sl1', bookingId: 'b1', items: [] }),
      },
      shoppingItem: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    } as unknown as PrismaService;

    const service = new ShoppingListsService(prisma);
    await service.regenerateForBooking('b1');

    expect(prisma.shoppingItem.createMany).toHaveBeenCalled();
    const call = (prisma.shoppingItem.createMany as jest.Mock).mock.calls[0][0];
    expect(call.data[0].name).toBe('Tomato');
  });
});
