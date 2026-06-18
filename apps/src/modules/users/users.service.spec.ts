import { UserRole } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: {
    user: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      user: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    service = new UsersService(prisma as unknown as PrismaService);
  });

  it('creates a client user with the client role', async () => {
    prisma.user.create.mockResolvedValue({ role: UserRole.client });

    await service.createUser({
      clerkUserId: 'clerk_1',
      email: 'client@example.com',
      fullName: 'Client One',
    });

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        clerkUserId: 'clerk_1',
        email: 'client@example.com',
        fullName: 'Client One',
        role: UserRole.client,
      },
    });
  });

  it('creates an admin user with the admin role', async () => {
    prisma.user.create.mockResolvedValue({ role: UserRole.admin });

    await service.createAdmin({
      clerkUserId: 'clerk_admin',
      email: 'admin@example.com',
      fullName: 'Admin One',
    });

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        clerkUserId: 'clerk_admin',
        email: 'admin@example.com',
        fullName: 'Admin One',
        role: UserRole.admin,
      },
    });
  });

  it('upserts a Clerk user with the client role fallback', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ role: UserRole.client });

    await service.upsertFromClerk({ clerkUserId: 'clerk_2' });

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        clerkUserId: 'clerk_2',
        email: 'clerk_2@unknown.invalid',
        fullName: null,
        role: UserRole.client,
      },
    });
  });
});