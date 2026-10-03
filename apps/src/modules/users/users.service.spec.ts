import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ChefApplicationStatus,
  ClientProfileStatus,
  UserRole,
} from '../../generated/prisma/client';
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
      findMany: jest.Mock;
      count: jest.Mock;
    };
    clientProfile: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    chefProfile: { findUnique: jest.Mock; upsert: jest.Mock; update: jest.Mock };
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
        findMany: jest.fn(),
        count: jest.fn(),
      },
      clientProfile: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      chefProfile: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
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

  describe('updateOwnChefProfile', () => {
    const chefUser = {
      id: 'user-1',
      clerkUserId: 'user_1',
      email: 'marie@exemple.fr',
      fullName: 'Marie Dupont',
      phone: null,
      role: UserRole.chef,
    };

    it('updates the public fields of the caller’s own profile', async () => {
      prisma.user.findUnique.mockResolvedValue(chefUser);
      prisma.chefProfile.findUnique.mockResolvedValue({ id: 'chef-1', isVerified: true });
      prisma.chefProfile.update.mockResolvedValue({ id: 'chef-1', bio: 'Nouvelle bio' });

      await service.updateOwnChefProfile('user_1', {
        bio: 'Nouvelle bio',
        serviceRadiusKm: 25,
      });

      expect(prisma.chefProfile.update).toHaveBeenCalledWith({
        where: { id: 'chef-1' },
        data: { bio: 'Nouvelle bio', serviceRadiusKm: 25 },
      });
    });

    it('never changes the role', async () => {
      prisma.user.findUnique.mockResolvedValue(chefUser);
      prisma.chefProfile.findUnique.mockResolvedValue({ id: 'chef-1', isVerified: true });

      await service.updateOwnChefProfile('user_1', {
        firstName: 'Marie',
        lastName: 'Martin',
      });

      // The name changed, so `users` WAS written — which is what makes the absence
      // of `role` below meaningful rather than vacuous.
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
      expect(prisma.user.update.mock.calls[0][0].data).toEqual({
        fullName: 'Marie Martin',
      });
    });

    it('refuses a client with no chef profile — this route no longer promotes anyone', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...chefUser, role: UserRole.client });
      prisma.chefProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.updateOwnChefProfile('user_1', { displayName: 'Chef Marie' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('never creates a chef profile', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...chefUser, role: UserRole.client });
      prisma.chefProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.updateOwnChefProfile('user_1', { displayName: 'Chef Marie' }),
      ).rejects.toThrow();
      expect(prisma.chefProfile.upsert).not.toHaveBeenCalled();
      expect(prisma.chefProfile.update).not.toHaveBeenCalled();
    });

    it('does not create a users row for an unknown caller', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.updateOwnChefProfile('user_unknown', { bio: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('refuses a candidate awaiting approval — browse-only, nothing written', async () => {
      prisma.user.findUnique.mockResolvedValue(chefUser);
      prisma.chefProfile.findUnique.mockResolvedValue({
        id: 'chef-1',
        isVerified: false,
      });

      await expect(
        service.updateOwnChefProfile('user_1', { firstName: 'Marie', bio: 'x' }),
      ).rejects.toMatchObject({ status: 403, response: { code: 'CHEF_NOT_VERIFIED' } });
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.chefProfile.update).not.toHaveBeenCalled();
    });
  });

  describe('setChefVerification', () => {
    const profile = (over: Record<string, unknown> = {}) => ({
      id: 'chef-1',
      isVerified: false,
      isActive: false,
      application: null,
      ...over,
    });

    it('updates the vetting flags of a profile that predates candidatures', async () => {
      prisma.chefProfile.findUnique.mockResolvedValue(profile());
      prisma.chefProfile.update.mockResolvedValue({ id: 'chef-1', isActive: true });

      await service.setChefVerification('chef-1', { isVerified: true, isActive: true });

      expect(prisma.chefProfile.update).toHaveBeenCalledWith({
        where: { id: 'chef-1' },
        data: { isVerified: true, isActive: true },
        include: { user: true },
      });
    });

    it.each([ChefApplicationStatus.submitted, ChefApplicationStatus.rejected])(
      'refuses to verify a candidate whose candidature is %s — approval is the only way',
      async (status) => {
        prisma.chefProfile.findUnique.mockResolvedValue(
          profile({ application: { status } }),
        );
        await expect(
          service.setChefVerification('chef-1', { isVerified: true }),
        ).rejects.toMatchObject({
          status: 409,
          response: { code: 'APPLICATION_NOT_APPROVED' },
        });
        expect(prisma.chefProfile.update).not.toHaveBeenCalled();
      },
    );

    it('re-verifies an approved chef whose verification an admin had revoked', async () => {
      prisma.chefProfile.findUnique.mockResolvedValue(
        profile({ application: { status: ChefApplicationStatus.approved } }),
      );
      await service.setChefVerification('chef-1', { isVerified: true });
      expect(prisma.chefProfile.update).toHaveBeenCalled();
    });

    it('refuses to put an unverified chef online', async () => {
      prisma.chefProfile.findUnique.mockResolvedValue(
        profile({ application: { status: ChefApplicationStatus.submitted } }),
      );
      await expect(
        service.setChefVerification('chef-1', { isActive: true }),
      ).rejects.toMatchObject({ status: 409, response: { code: 'CHEF_NOT_VERIFIED' } });
      expect(prisma.chefProfile.update).not.toHaveBeenCalled();
    });

    it('refuses to revoke verification while leaving the chef online', async () => {
      prisma.chefProfile.findUnique.mockResolvedValue(
        profile({ isVerified: true, isActive: true }),
      );
      await expect(
        service.setChefVerification('chef-1', { isVerified: false }),
      ).rejects.toMatchObject({ response: { code: 'CHEF_NOT_VERIFIED' } });
    });

    it('always allows taking a chef offline', async () => {
      prisma.chefProfile.findUnique.mockResolvedValue(
        profile({
          isVerified: true,
          isActive: true,
          application: { status: ChefApplicationStatus.approved },
        }),
      );
      await service.setChefVerification('chef-1', { isActive: false, isVerified: false });
      expect(prisma.chefProfile.update).toHaveBeenCalled();
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
    const clientProfile = { id: 'profile-1', userId: 'uuid-1' };
    const clientUser = { id: 'uuid-1', role: UserRole.client };

    beforeEach(() => {
      prisma.user.findMany.mockResolvedValue([{ ...clientUser, clientProfile }]);
      prisma.user.count.mockResolvedValue(41);
    });

    it('applies default page and limit when the query is empty', async () => {
      const result = await service.listClients();

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { role: UserRole.client },
        include: { clientProfile: true },
        // `id` is the tiebreaker that keeps paging stable across equal timestamps.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 0,
        take: 20,
      });
      expect(result).toEqual({
        data: [{ user: clientUser, clientProfile }],
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

    it('lists clients who have not saved a profile yet', async () => {
      // Listing `client_profiles` hid every client who signed up but never saved
      // their preferences: they have a `users` row and no profile row.
      prisma.user.findMany.mockResolvedValue([{ ...clientUser, clientProfile: null }]);

      const result = await service.listClients();

      expect(result.data).toEqual([{ user: clientUser, clientProfile: null }]);
    });

    it('translates page/limit into skip/take and reports the last page', async () => {
      const result = await service.listClients({ page: 3, limit: 20 });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 40, take: 20 }),
      );
      expect(result.meta).toMatchObject({
        page: 3,
        hasNextPage: false,
        hasPreviousPage: true,
      });
    });

    it('counts with the same status filter it queries with', async () => {
      prisma.user.count.mockResolvedValue(1);

      const result = await service.listClients({
        status: ClientProfileStatus.vip,
        limit: 5,
      });

      const where = {
        role: UserRole.client,
        clientProfile: { status: ClientProfileStatus.vip },
      };
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where }),
      );
      expect(prisma.user.count).toHaveBeenCalledWith({ where });
      expect(result.meta).toMatchObject({ total: 1, totalPages: 1, limit: 5 });
    });

    it('reads rows and total in one transaction so the count matches the page', async () => {
      await service.listClients();

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(2);
    });

    it('clamps an oversized limit from a direct (non-HTTP) caller', async () => {
      await service.listClients({ page: 0, limit: 5_000 });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 100 }),
      );
    });

    it('reports zero pages when no client matches', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      const result = await service.listClients();

      expect(result.meta).toMatchObject({
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
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
