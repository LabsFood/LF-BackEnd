import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { StatsService } from './stats.service';

describe('StatsService', () => {
  it("ranks top meals among Lab's Food meals only", async () => {
    const groupBy = jest.fn().mockResolvedValue([]);
    const prisma = {
      booking: {
        aggregate: jest.fn().mockResolvedValue({ _sum: {} }),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      bookingMeal: { groupBy },
    } as unknown as PrismaService;
    const service = new StatsService(prisma, {} as UsersService);

    await service.getAdminDashboard();

    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { meal: { chefProfileId: null } } }),
    );
  });
});
