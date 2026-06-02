import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { QuotesService } from './quotes.service';

describe('QuotesService', () => {
  it('generates DEM reference and persists quote', async () => {
    const prisma = {
      quote: {
        count: jest.fn().mockResolvedValue(12),
        create: jest.fn().mockResolvedValue({ id: 'q1', reference: 'DEM-2026-0013' }),
      },
    } as unknown as PrismaService;
    const users = {
      upsertFromClerk: jest.fn().mockResolvedValue({ id: 'u1' }),
    } as unknown as UsersService;
    const service = new QuotesService(prisma, users);

    const created = await service.createQuote('clerk_1', {
      title: 'Sunday prep',
      persons: 4,
      mealsCount: 5,
      cuisine: 'mediterranean',
      brief: 'Family batch cooking',
      diet: [],
    });

    expect(created.reference).toMatch(/^DEM-\d{4}-\d{4}$/);
    expect(prisma.quote.count).toHaveBeenCalled();
    expect(prisma.quote.create).toHaveBeenCalled();
  });
});
