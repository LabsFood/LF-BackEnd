import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProfileStatus, UserRole } from '../../generated/prisma/client';
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
    clientProfile: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    chefProfile: { findUnique: jest.Mock; upsert: jest.Mock; update: jest.Mock };
    sapProfile: { findUnique: jest.Mock; upsert: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };
  let clerk: {
    configured: boolean;
    getClient: jest.Mock;
  };
  let config: { get: jest.Mock };
  let service: UsersService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      clientProfile: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      chefProfile: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
      sapProfile: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
      $transaction: jest.fn((operations: unknown[]) => Promise.all(operations)),
    };
    clerk = {
      configured: false,
      getClient: jest.fn(),
    };
    config = { get: jest.fn((_key: string, fallback?: unknown) => fallback) };
    service = new UsersService(
      prisma as unknown as PrismaService,
      clerk as unknown as ClerkService,
      config as unknown as ConfigService,
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
      const ensureSpy = jest
        .spyOn(service, 'ensurePersistedFromClerk')
        .mockResolvedValue({
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

  describe('registerClient', () => {
    const configureClerk = (createUser: jest.Mock, createSignInToken: jest.Mock) => {
      clerk.configured = true;
      clerk.getClient.mockReturnValue({
        users: { createUser },
        signInTokens: { createSignInToken },
      });
    };

    it('returns 503 when Clerk is not configured', async () => {
      clerk.configured = false;
      await expect(
        service.registerClient({
          email: 'new@example.com',
          password: 'Str0ng!UniquePass',
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('rejects an email already present in Postgres before creating in Clerk', async () => {
      const createUser = jest.fn();
      configureClerk(createUser, jest.fn());
      prisma.user.findUnique.mockResolvedValue({ id: 'uuid-existing' });

      await expect(
        service.registerClient({
          email: 'taken@example.com',
          password: 'Str0ng!UniquePass',
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      // The point of the pre-check: no orphaned Clerk account is left behind.
      expect(createUser).not.toHaveBeenCalled();
    });

    it('always persists role client and returns a sign-in ticket', async () => {
      const createUser = jest.fn().mockResolvedValue({ id: 'user_clerk_new' });
      const createSignInToken = jest.fn().mockResolvedValue({ token: 'sit_abc123' });
      configureClerk(createUser, createSignInToken);
      prisma.user.findUnique.mockResolvedValue(null);
      const createWithRoleSpy = jest.spyOn(service, 'createWithRole').mockResolvedValue({
        id: 'uuid-1',
        clerkUserId: 'user_clerk_new',
        email: 'new@example.com',
        role: UserRole.client,
      } as never);

      const result = await service.registerClient({
        email: 'new@example.com',
        password: 'Str0ng!UniquePass',
      });

      expect(createWithRoleSpy).toHaveBeenCalledWith(
        expect.objectContaining({ role: UserRole.client }),
      );
      expect(createSignInToken).toHaveBeenCalledWith({
        userId: 'user_clerk_new',
        expiresInSeconds: 3600,
      });
      expect(result).toEqual({
        user: expect.objectContaining({ role: UserRole.client }),
        signInToken: 'sit_abc123',
        expiresInSeconds: 3600,
      });
    });

    it('ignores any role reaching the service and still persists client', async () => {
      const createUser = jest.fn().mockResolvedValue({ id: 'user_clerk_new' });
      configureClerk(createUser, jest.fn().mockResolvedValue({ token: 'sit_abc123' }));
      prisma.user.findUnique.mockResolvedValue(null);
      const createWithRoleSpy = jest.spyOn(service, 'createWithRole').mockResolvedValue({
        id: 'uuid-1',
        clerkUserId: 'user_clerk_new',
        role: UserRole.client,
      } as never);

      await service.registerClient({
        email: 'new@example.com',
        password: 'Str0ng!UniquePass',
        role: UserRole.admin,
      } as never);

      expect(createWithRoleSpy).toHaveBeenCalledWith(
        expect.objectContaining({ role: UserRole.client }),
      );
    });
  });

  describe('updateProfileByClerkUserId', () => {
    const currentUser = {
      id: 'uuid-1',
      clerkUserId: 'user_1',
      email: 'a@example.com',
      fullName: null,
      phone: null,
      role: UserRole.client,
    };

    it('splits user-level fields out of the client_profiles payload', async () => {
      jest
        .spyOn(service, 'ensurePersistedFromClerk')
        .mockResolvedValue(currentUser as never);
      prisma.chefProfile.findUnique.mockResolvedValue(null);
      prisma.user.update.mockResolvedValue(currentUser);
      prisma.clientProfile.upsert.mockResolvedValue({ id: 'profile-1' });

      await service.updateProfileByClerkUserId('user_1', {
        firstName: 'Marie',
        lastName: 'Dupont',
        phone: '+33612345678',
        addressStreet: '12 rue de la Paix',
        addressCity: 'Paris',
        addressPostalCode: '75002',
        householdAdults: 2,
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
        data: { fullName: 'Marie Dupont', phone: '+33612345678' },
      });

      // firstName/lastName/phone must never reach client_profiles — no such columns.
      const upsertArg = prisma.clientProfile.upsert.mock.calls[0][0];
      expect(upsertArg.update).not.toHaveProperty('firstName');
      expect(upsertArg.update).not.toHaveProperty('lastName');
      expect(upsertArg.update).not.toHaveProperty('phone');
      expect(upsertArg.update).toMatchObject({
        addressStreet: '12 rue de la Paix',
        addressCity: 'Paris',
        addressPostalCode: '75002',
        householdAdults: 2,
      });
    });

    it('never writes users.role when saving a client profile', async () => {
      jest
        .spyOn(service, 'ensurePersistedFromClerk')
        .mockResolvedValue(currentUser as never);
      prisma.chefProfile.findUnique.mockResolvedValue(null);
      prisma.user.update.mockResolvedValue(currentUser);
      prisma.clientProfile.upsert.mockResolvedValue({ id: 'profile-1' });

      await service.updateProfileByClerkUserId('user_1', {
        firstName: 'Marie',
        allergies: ['peanuts'],
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
        data: { fullName: 'Marie' },
      });
      expect(prisma.user.update.mock.calls[0][0].data).not.toHaveProperty('role');
    });

    it('does not demote an admin who saves a client profile', async () => {
      jest
        .spyOn(service, 'ensurePersistedFromClerk')
        .mockResolvedValue({ ...currentUser, role: UserRole.admin } as never);
      prisma.chefProfile.findUnique.mockResolvedValue(null);
      prisma.user.update.mockResolvedValue(currentUser);
      prisma.clientProfile.upsert.mockResolvedValue({ id: 'profile-1' });

      await service.updateProfileByClerkUserId('user_1', { firstName: 'Marie' });

      // Demoting here would strip the admin of back-office access, potentially
      // locking out the only admin on the instance.
      expect(prisma.user.update.mock.calls[0][0].data).not.toHaveProperty('role');
    });

    it('touches users at all only when identity fields change', async () => {
      jest
        .spyOn(service, 'ensurePersistedFromClerk')
        .mockResolvedValue(currentUser as never);
      prisma.chefProfile.findUnique.mockResolvedValue(null);
      prisma.clientProfile.upsert.mockResolvedValue({ id: 'profile-1' });

      await service.updateProfileByClerkUserId('user_1', { allergies: ['peanuts'] });

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a client profile when a chef profile already exists', async () => {
      jest
        .spyOn(service, 'ensurePersistedFromClerk')
        .mockResolvedValue(currentUser as never);
      prisma.chefProfile.findUnique.mockResolvedValue({ id: 'chef-1' });

      await expect(
        service.updateProfileByClerkUserId('user_1', { firstName: 'Marie' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.clientProfile.upsert).not.toHaveBeenCalled();
    });
  });

  describe('updateChefProfileByClerkUserId', () => {
    const currentUser = {
      id: 'uuid-1',
      clerkUserId: 'user_1',
      email: 'chef@example.com',
      fullName: null,
      phone: null,
      role: UserRole.client,
    };

    it('promotes role to chef and forces the profile inactive and unverified', async () => {
      jest
        .spyOn(service, 'ensurePersistedFromClerk')
        .mockResolvedValue(currentUser as never);
      prisma.clientProfile.findUnique.mockResolvedValue(null);
      prisma.user.update.mockResolvedValue(currentUser);
      prisma.chefProfile.upsert.mockResolvedValue({ id: 'chef-1' });

      await service.updateChefProfileByClerkUserId('user_1', {
        displayName: 'Chef Marie D.',
        city: 'Paris',
        serviceRadiusKm: 25,
        firstName: 'Marie',
        lastName: 'Dupont',
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
        data: { fullName: 'Marie Dupont', role: UserRole.chef },
      });
      expect(prisma.chefProfile.upsert.mock.calls[0][0].create).toMatchObject({
        displayName: 'Chef Marie D.',
        serviceRadiusKm: 25,
        isActive: false,
        isVerified: false,
      });
    });

    it('does not demote an admin who saves a chef profile', async () => {
      jest
        .spyOn(service, 'ensurePersistedFromClerk')
        .mockResolvedValue({ ...currentUser, role: UserRole.admin } as never);
      prisma.clientProfile.findUnique.mockResolvedValue(null);
      prisma.user.update.mockResolvedValue(currentUser);
      prisma.chefProfile.upsert.mockResolvedValue({ id: 'chef-1' });

      await service.updateChefProfileByClerkUserId('user_1', {
        displayName: 'Chef Admin',
        firstName: 'Marie',
      });

      // Promotion is client -> chef only; admin must survive chef onboarding.
      expect(prisma.user.update.mock.calls[0][0].data).not.toHaveProperty('role');
    });

    it('cannot be tricked into self-verifying via the payload', async () => {
      jest
        .spyOn(service, 'ensurePersistedFromClerk')
        .mockResolvedValue(currentUser as never);
      prisma.clientProfile.findUnique.mockResolvedValue(null);
      prisma.user.update.mockResolvedValue(currentUser);
      prisma.chefProfile.upsert.mockResolvedValue({ id: 'chef-1' });

      await service.updateChefProfileByClerkUserId('user_1', {
        displayName: 'Sneaky Chef',
        isActive: true,
        isVerified: true,
      } as never);

      expect(prisma.chefProfile.upsert.mock.calls[0][0].create).toMatchObject({
        isActive: false,
        isVerified: false,
      });
    });

    it('rejects a chef profile when a client profile already exists', async () => {
      jest
        .spyOn(service, 'ensurePersistedFromClerk')
        .mockResolvedValue(currentUser as never);
      prisma.clientProfile.findUnique.mockResolvedValue({ id: 'client-1' });

      await expect(
        service.updateChefProfileByClerkUserId('user_1', { displayName: 'Chef' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.chefProfile.upsert).not.toHaveBeenCalled();
    });
  });

  describe('setChefVerification', () => {
    it('updates the vetting flags', async () => {
      prisma.chefProfile.findUnique.mockResolvedValue({ id: 'chef-1' });
      prisma.chefProfile.update.mockResolvedValue({ id: 'chef-1', isActive: true });

      await service.setChefVerification('chef-1', { isVerified: true, isActive: true });

      expect(prisma.chefProfile.update).toHaveBeenCalledWith({
        where: { id: 'chef-1' },
        data: { isVerified: true, isActive: true },
        include: { user: true },
      });
    });

    it('throws when the chef profile is missing', async () => {
      prisma.chefProfile.findUnique.mockResolvedValue(null);
      await expect(
        service.setChefVerification('missing', { isActive: true }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getProfileByClerkUserId', () => {
    it('returns the chef profile for a chef user', async () => {
      jest.spyOn(service, 'ensurePersistedFromClerk').mockResolvedValue({
        id: 'uuid-1',
        role: UserRole.chef,
      } as never);
      prisma.chefProfile.findUnique.mockResolvedValue({ id: 'chef-1' });

      const result = await service.getProfileByClerkUserId('user_1');

      expect(result.profileType).toBe('chef');
      expect(result.profile).toEqual({ id: 'chef-1' });
      expect(prisma.clientProfile.findUnique).not.toHaveBeenCalled();
    });

    it('reports none when the user has not completed onboarding', async () => {
      jest.spyOn(service, 'ensurePersistedFromClerk').mockResolvedValue({
        id: 'uuid-1',
        role: UserRole.client,
      } as never);
      prisma.clientProfile.findUnique.mockResolvedValue(null);

      const result = await service.getProfileByClerkUserId('user_1');

      expect(result.profileType).toBe('none');
      expect(result.profile).toBeNull();
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

  describe('listClients', () => {
    const clientRow = { id: 'client-1', user: { id: 'uuid-1' } };

    beforeEach(() => {
      prisma.clientProfile.findMany.mockResolvedValue([clientRow]);
      prisma.clientProfile.count.mockResolvedValue(41);
    });

    it('applies default page and limit when the query is empty', async () => {
      const result = await service.listClients();

      expect(prisma.clientProfile.findMany).toHaveBeenCalledWith({
        where: undefined,
        include: { user: true },
        // `id` is the tiebreaker that keeps paging stable across equal timestamps.
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: 0,
        take: 20,
      });
      expect(result).toEqual({
        data: [clientRow],
        meta: {
          page: 1,
          limit: 20,
          total: 41,
          totalPages: 3,
          hasNextPage: true,
          hasPreviousPage: false,
        },
      });
    });

    it('translates page/limit into skip/take and reports the last page', async () => {
      const result = await service.listClients({ page: 3, limit: 20 });

      expect(prisma.clientProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 40, take: 20 }),
      );
      expect(result.meta).toMatchObject({
        page: 3,
        hasNextPage: false,
        hasPreviousPage: true,
      });
    });

    it('counts with the same status filter it queries with', async () => {
      prisma.clientProfile.count.mockResolvedValue(1);

      const result = await service.listClients({
        status: ClientProfileStatus.vip,
        limit: 5,
      });

      const where = { status: ClientProfileStatus.vip };
      expect(prisma.clientProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where }),
      );
      expect(prisma.clientProfile.count).toHaveBeenCalledWith({ where });
      expect(result.meta).toMatchObject({ total: 1, totalPages: 1, limit: 5 });
    });

    it('reads rows and total in one transaction so the count matches the page', async () => {
      await service.listClients();

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(2);
    });

    it('clamps an oversized limit from a direct (non-HTTP) caller', async () => {
      await service.listClients({ page: 0, limit: 5_000 });

      expect(prisma.clientProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 100 }),
      );
    });

    it('reports zero pages when no client matches', async () => {
      prisma.clientProfile.findMany.mockResolvedValue([]);
      prisma.clientProfile.count.mockResolvedValue(0);

      const result = await service.listClients();

      expect(result.meta).toMatchObject({
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      });
    });
  });

  describe('SAP profile', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        clerkUserId: 'clerk_1',
        email: 'chef@example.com',
        fullName: 'Chef Marie',
        phone: null,
        role: UserRole.chef,
      });
      prisma.chefProfile.findUnique.mockResolvedValue({ id: 'chef-1' });
      prisma.sapProfile.upsert.mockImplementation((args: unknown) =>
        Promise.resolve(args),
      );
    });

    it('upserts a type A declaration and clears the cooperative fields', async () => {
      await service.updateSapProfileByClerkUserId('clerk_1', {
        declarationType: 'type_a_nova',
        novaCode: 'SAP123456789',
      });

      expect(prisma.sapProfile.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { chefProfileId: 'chef-1' },
          update: {
            acceptsCesu: false,
            declarationType: 'type_a_nova',
            novaCode: 'SAP123456789',
            cooperativeName: null,
            cooperativeMembershipProof: null,
            crcesuNan: null,
          },
        }),
      );
    });

    it('upserts a type B declaration and clears the NOVA code', async () => {
      await service.updateSapProfileByClerkUserId('clerk_1', {
        declarationType: 'type_b_cooperative',
        cooperativeName: 'Unipros',
        cooperativeMembershipProof: 'https://files.test/proof.pdf',
        crcesuNan: '1234567',
      });

      expect(prisma.sapProfile.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: {
            acceptsCesu: false,
            declarationType: 'type_b_cooperative',
            novaCode: null,
            cooperativeName: 'Unipros',
            cooperativeMembershipProof: 'https://files.test/proof.pdf',
            crcesuNan: '1234567',
          },
        }),
      );
    });

    it('never accepts the URSSAF or CRCESU status from the caller', async () => {
      await service.updateSapProfileByClerkUserId('clerk_1', {
        declarationType: 'type_a_nova',
        novaCode: 'SAP123456789',
      });

      const [{ update, create }] = prisma.sapProfile.upsert.mock.calls[0] as [
        { update: Record<string, unknown>; create: Record<string, unknown> },
      ];
      for (const fields of [update, create]) {
        expect(fields).not.toHaveProperty('urssafTiersPrestationStatus');
        expect(fields).not.toHaveProperty('crcesuAffiliationStatus');
      }
    });

    it('records the CESU opt-in the chef sent', async () => {
      await service.updateSapProfileByClerkUserId('clerk_1', {
        declarationType: 'type_a_nova',
        novaCode: 'SAP123456789',
        crcesuNan: '1234567',
        acceptsCesu: true,
      });

      expect(prisma.sapProfile.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ acceptsCesu: true, crcesuNan: '1234567' }),
        }),
      );
    });

    it('refuses to write before the chef profile exists', async () => {
      prisma.chefProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.updateSapProfileByClerkUserId('clerk_1', {
          declarationType: 'type_a_nova',
          novaCode: 'SAP123456789',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.sapProfile.upsert).not.toHaveBeenCalled();
    });

    describe('setSapExternalStatus', () => {
      it('is the writer the CRCESU affiliation never had', async () => {
        prisma.sapProfile.findUnique.mockResolvedValue({ id: 'sap-1' });
        prisma.sapProfile.update.mockResolvedValue({ id: 'sap-1' });

        await service.setSapExternalStatus('chef-1', {
          crcesuAffiliationStatus: 'active',
        });

        expect(prisma.sapProfile.update).toHaveBeenCalledWith({
          where: { chefProfileId: 'chef-1' },
          data: { crcesuAffiliationStatus: 'active' },
        });
      });

      it('leaves an omitted status untouched', async () => {
        prisma.sapProfile.findUnique.mockResolvedValue({ id: 'sap-1' });
        prisma.sapProfile.update.mockResolvedValue({ id: 'sap-1' });

        await service.setSapExternalStatus('chef-1', {
          urssafTiersPrestationStatus: 'pending',
        });

        const [{ data }] = prisma.sapProfile.update.mock.calls[0] as [
          { data: Record<string, unknown> },
        ];
        expect(data).not.toHaveProperty('crcesuAffiliationStatus');
      });

      it('404s when the chef has not declared a SAP route', async () => {
        prisma.sapProfile.findUnique.mockResolvedValue(null);

        await expect(
          service.setSapExternalStatus('chef-1', { crcesuAffiliationStatus: 'active' }),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(prisma.sapProfile.update).not.toHaveBeenCalled();
      });
    });

    it('reads the declaration of the authenticated chef', async () => {
      prisma.sapProfile.findUnique.mockResolvedValue({ id: 'sap-1' });

      await expect(service.getSapProfileByClerkUserId('clerk_1')).resolves.toEqual({
        id: 'sap-1',
      });
      expect(prisma.sapProfile.findUnique).toHaveBeenCalledWith({
        where: { chefProfileId: 'chef-1' },
      });
    });

    it('refuses to read before the chef profile exists', async () => {
      prisma.chefProfile.findUnique.mockResolvedValue(null);

      await expect(service.getSapProfileByClerkUserId('clerk_1')).rejects.toBeInstanceOf(
        ConflictException,
      );
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
