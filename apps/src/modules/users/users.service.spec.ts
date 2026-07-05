import { UserRole } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let prisma: {
    user: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      deleteMany: jest.Mock;
    };
    clientProfile: { findUnique: jest.Mock; upsert: jest.Mock };
  };
  let service: UsersService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      clientProfile: { findUnique: jest.fn(), upsert: jest.fn() },
    };
    service = new UsersService(prisma as unknown as PrismaService);
  });

  describe('upsertFromClerk', () => {
    it('creates a client user when no row exists', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'uuid-1',
        clerkUserId: 'user_new',
        email: 'a@example.com',
        role: UserRole.client,
      });

      const user = await service.upsertFromClerk({
        clerkUserId: 'user_new',
        email: 'a@example.com',
        fullName: 'Ada Lovelace',
      });

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          clerkUserId: 'user_new',
          email: 'a@example.com',
          fullName: 'Ada Lovelace',
          role: UserRole.client,
        },
      });
      expect(user.clerkUserId).toBe('user_new');
    });

    it('updates email and full name when they change', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'uuid-1',
        clerkUserId: 'user_1',
        email: 'old@example.com',
        fullName: 'Old Name',
      });
      prisma.user.update.mockResolvedValue({
        id: 'uuid-1',
        clerkUserId: 'user_1',
        email: 'new@example.com',
        fullName: 'New Name',
      });

      await service.upsertFromClerk({
        clerkUserId: 'user_1',
        email: 'new@example.com',
        fullName: 'New Name',
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
        data: { email: 'new@example.com', fullName: 'New Name' },
      });
    });
  });

  describe('upsertFromClerkUserJson', () => {
    it('maps Clerk UserJSON to upsert input', async () => {
      const upsertSpy = jest.spyOn(service, 'upsertFromClerk').mockResolvedValue({
        id: 'uuid-1',
      } as never);

      await service.upsertFromClerkUserJson({
        id: 'user_abc',
        first_name: 'Marie',
        last_name: 'Curie',
        email_addresses: [
          {
            id: 'em_1',
            email_address: 'marie@example.com',
          } as never,
        ],
        primary_email_address_id: 'em_1',
      } as never);

      expect(upsertSpy).toHaveBeenCalledWith({
        clerkUserId: 'user_abc',
        email: 'marie@example.com',
        fullName: 'Marie Curie',
      });
    });
  });

  describe('deleteByClerkId', () => {
    it('deletes by clerk_user_id', async () => {
      prisma.user.deleteMany.mockResolvedValue({ count: 1 });
      await service.deleteByClerkId('user_gone');
      expect(prisma.user.deleteMany).toHaveBeenCalledWith({
        where: { clerkUserId: 'user_gone' },
      });
    });
  });
});
