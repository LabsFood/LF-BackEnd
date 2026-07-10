import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client';
import { ClerkService } from '../../integrations/clerk.service';
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
  let clerk: {
    configured: boolean;
    getClient: jest.Mock;
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
    clerk = {
      configured: false,
      getClient: jest.fn(),
    };
    service = new UsersService(
      prisma as unknown as PrismaService,
      clerk as unknown as ClerkService,
    );
  });

  describe('ensurePersistedFromClerk', () => {
    it('fetches Clerk profile via BAPI and upserts when Clerk is configured', async () => {
      clerk.configured = true;
      clerk.getClient.mockReturnValue({
        users: {
          getUser: jest.fn().mockResolvedValue({
            id: 'user_bapi',
            firstName: 'Ada',
            lastName: 'Lovelace',
            emailAddresses: [{ id: 'em_1', emailAddress: 'ada@example.com' }],
            primaryEmailAddressId: 'em_1',
            phoneNumbers: [{ id: 'ph_1', phoneNumber: '+33601020304' }],
            primaryPhoneNumberId: 'ph_1',
          }),
        },
      });
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'uuid-1',
        clerkUserId: 'user_bapi',
        email: 'ada@example.com',
        fullName: 'Ada Lovelace',
        phone: '+33601020304',
        role: UserRole.client,
      });

      const user = await service.ensurePersistedFromClerk('user_bapi', {
        email: 'jwt-fallback@example.com',
      });

      expect(clerk.getClient().users.getUser).toHaveBeenCalledWith('user_bapi');
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          clerkUserId: 'user_bapi',
          email: 'ada@example.com',
          fullName: 'Ada Lovelace',
          phone: '+33601020304',
          role: UserRole.client,
        },
      });
      expect(user.clerkUserId).toBe('user_bapi');
    });

    it('falls back to JWT hints when BAPI lookup fails', async () => {
      clerk.configured = true;
      clerk.getClient.mockReturnValue({
        users: {
          getUser: jest.fn().mockRejectedValue(new Error('not found')),
        },
      });
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'uuid-1',
        clerkUserId: 'user_jwt',
        email: 'jwt@example.com',
        role: UserRole.client,
      });

      await service.ensurePersistedFromClerk('user_jwt', { email: 'jwt@example.com' });

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          clerkUserId: 'user_jwt',
          email: 'jwt@example.com',
          fullName: null,
          phone: null,
          role: UserRole.client,
        },
      });
    });

    it('uses JWT hints only in stub mode', async () => {
      clerk.configured = false;
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 'uuid-1' });

      await service.ensurePersistedFromClerk('user_stub', { email: 'stub@example.com' });

      expect(clerk.getClient).not.toHaveBeenCalled();
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          clerkUserId: 'user_stub',
          email: 'stub@example.com',
        }),
      });
    });
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
          phone: null,
          role: UserRole.client,
        },
      });
      expect(user.clerkUserId).toBe('user_new');
    });

    it('creates with an explicit role when provided', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'uuid-1',
        role: UserRole.chef,
      });

      await service.upsertFromClerk({
        clerkUserId: 'user_chef',
        email: 'chef@example.com',
        role: UserRole.chef,
      });

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ role: UserRole.chef }),
      });
    });

    it('updates email, full name, and phone when they change', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'uuid-1',
        clerkUserId: 'user_1',
        email: 'old@example.com',
        fullName: 'Old Name',
        phone: null,
        role: UserRole.client,
      });
      prisma.user.update.mockResolvedValue({
        id: 'uuid-1',
        clerkUserId: 'user_1',
        email: 'new@example.com',
        fullName: 'New Name',
        phone: '+33601020304',
      });

      await service.upsertFromClerk({
        clerkUserId: 'user_1',
        email: 'new@example.com',
        fullName: 'New Name',
        phone: '+33601020304',
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
        data: {
          email: 'new@example.com',
          fullName: 'New Name',
          phone: '+33601020304',
        },
      });
    });

    it('does not change role on update when role is omitted', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'uuid-1',
        clerkUserId: 'user_1',
        email: 'a@example.com',
        fullName: null,
        role: UserRole.admin,
      });

      const result = await service.upsertFromClerk({
        clerkUserId: 'user_1',
        email: 'a@example.com',
      });

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(result.role).toBe(UserRole.admin);
    });
  });

  describe('createWithRole', () => {
    it('delegates to upsertFromClerk with explicit role', async () => {
      const upsertSpy = jest.spyOn(service, 'upsertFromClerk').mockResolvedValue({
        id: 'uuid-1',
        role: UserRole.admin,
      } as never);

      await service.createWithRole({
        clerkUserId: 'user_admin',
        email: 'admin@example.com',
        fullName: 'Admin User',
        role: UserRole.admin,
      });

      expect(upsertSpy).toHaveBeenCalledWith({
        clerkUserId: 'user_admin',
        email: 'admin@example.com',
        fullName: 'Admin User',
        role: UserRole.admin,
      });
    });
  });

  describe('updateRole', () => {
    it('syncs Clerk profile before updating role', async () => {
      const ensureSpy = jest.spyOn(service, 'ensurePersistedFromClerk').mockResolvedValue({
        id: 'uuid-1',
        clerkUserId: 'user_1',
        role: UserRole.client,
      } as never);
      prisma.user.findUnique.mockResolvedValue({
        id: 'uuid-1',
        clerkUserId: 'user_1',
        role: UserRole.client,
      });
      prisma.user.update.mockResolvedValue({
        id: 'uuid-1',
        role: UserRole.admin,
      });

      const user = await service.updateRole('uuid-1', UserRole.admin);

      expect(ensureSpy).toHaveBeenCalledWith('user_1');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
        data: { role: UserRole.admin },
      });
      expect(user.role).toBe(UserRole.admin);
    });

    it('throws when user is missing', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.updateRole('missing', UserRole.chef)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('merges Clerk publicMetadata.role when Clerk is configured', async () => {
      jest.spyOn(service, 'ensurePersistedFromClerk').mockResolvedValue({
        id: 'uuid-1',
        clerkUserId: 'user_1',
        role: UserRole.client,
      } as never);
      clerk.configured = true;
      const updateUser = jest.fn().mockResolvedValue({});
      clerk.getClient.mockReturnValue({
        users: {
          getUser: jest.fn().mockResolvedValue({
            publicMetadata: { locale: 'fr' },
          }),
          updateUser,
        },
      });
      prisma.user.findUnique.mockResolvedValue({
        id: 'uuid-1',
        clerkUserId: 'user_1',
        role: UserRole.client,
      });
      prisma.user.update.mockResolvedValue({
        id: 'uuid-1',
        role: UserRole.chef,
      });

      await service.updateRole('uuid-1', UserRole.chef);

      expect(updateUser).toHaveBeenCalledWith('user_1', {
        publicMetadata: { locale: 'fr', role: UserRole.chef },
      });
    });
  });

  describe('provisionAdminUser', () => {
    it('returns 503 when Clerk is not configured', async () => {
      clerk.configured = false;
      await expect(
        service.provisionAdminUser({ email: 'new@example.com' }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('creates Clerk user and persists Postgres row', async () => {
      clerk.configured = true;
      clerk.getClient.mockReturnValue({
        users: {
          createUser: jest.fn().mockResolvedValue({ id: 'user_clerk_new' }),
        },
      });
      const createWithRoleSpy = jest.spyOn(service, 'createWithRole').mockResolvedValue({
        id: 'uuid-1',
        clerkUserId: 'user_clerk_new',
        email: 'new@example.com',
        role: UserRole.client,
      } as never);

      const user = await service.provisionAdminUser({
        email: 'new@example.com',
        firstName: 'New',
        lastName: 'User',
        password: 'password123',
        role: UserRole.client,
      });

      expect(clerk.getClient().users.createUser).toHaveBeenCalledWith({
        emailAddress: ['new@example.com'],
        password: 'password123',
        firstName: 'New',
        lastName: 'User',
        skipPasswordRequirement: false,
      });
      expect(createWithRoleSpy).toHaveBeenCalledWith({
        clerkUserId: 'user_clerk_new',
        email: 'new@example.com',
        fullName: 'New User',
        role: UserRole.client,
      });
      expect(user.clerkUserId).toBe('user_clerk_new');
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
        phone: null,
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
