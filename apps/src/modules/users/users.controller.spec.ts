import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClientProfileStatus, UserRole } from '../../generated/prisma/client';

import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard } from '../../auth/clerk-auth.guard';
import { ListAdminClientsQueryDto } from './dto/admin-client.dto';
import { CreateAdminUserDto, UpdateUserRoleDto } from './dto/admin-user.dto';
import { UpdateMeChefProfileDto } from './dto/chef-profile.dto';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  let users: jest.Mocked<
    Pick<
      UsersService,
      | 'provisionAdminUser'
      | 'updateRole'
      | 'toUserRole'
      | 'setChefVerification'
      | 'listClients'
      | 'listUsers'
      | 'updateOwnChefProfile'
    >
  >;

  beforeEach(async () => {
    users = {
      provisionAdminUser: jest.fn().mockResolvedValue({
        id: 'uuid-1',
        clerkUserId: 'user_new',
        email: 'new@example.com',
        role: UserRole.client,
      }),
      updateRole: jest.fn().mockResolvedValue({
        id: 'uuid-1',
        role: UserRole.admin,
      }),
      toUserRole: jest.fn((role) => role as UserRole),
      updateOwnChefProfile: jest.fn().mockResolvedValue({
        id: 'chef-1',
        displayName: 'Chef Marie D.',
        isActive: false,
        isVerified: true,
      }),
      setChefVerification: jest.fn().mockResolvedValue({
        id: 'chef-1',
        isActive: true,
        isVerified: true,
      }),
      listUsers: jest.fn().mockResolvedValue({ data: [], meta: {} }),
      listClients: jest.fn().mockResolvedValue({
        data: [],
        meta: {
          page: 2,
          limit: 10,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: true,
        },
      }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: users }],
    })
      .overrideGuard(ClerkAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(UsersController);
  });

  it('delegates admin user creation to the service', async () => {
    const payload: CreateAdminUserDto = {
      email: 'new@example.com',
      firstName: 'New',
      role: 'chef',
    };

    await expect(controller.createAdminUser(payload)).resolves.toEqual(
      expect.objectContaining({ email: 'new@example.com' }),
    );
    expect(users.provisionAdminUser).toHaveBeenCalledWith({
      email: 'new@example.com',
      password: undefined,
      firstName: 'New',
      lastName: undefined,
      role: UserRole.chef,
    });
  });

  it('delegates role updates to the service', async () => {
    const payload: UpdateUserRoleDto = { role: 'admin' };

    await expect(controller.updateUserRole('uuid-1', payload)).resolves.toEqual(
      expect.objectContaining({ role: UserRole.admin }),
    );
    expect(users.updateRole).toHaveBeenCalledWith('uuid-1', UserRole.admin);
  });

  it('routes chef self-edit to the update-only service, keyed by the session subject', async () => {
    await controller.patchMeChefProfile({ userId: 'user_1' }, { bio: 'Nouvelle bio' });

    // The Clerk subject decides whose profile is edited — never a body field.
    expect(users.updateOwnChefProfile).toHaveBeenCalledWith('user_1', {
      bio: 'Nouvelle bio',
    });
  });

  describe('UpdateMeChefProfileDto under the global validation pipe', () => {
    // Mirrors `main.ts`. A chef editing their own profile must not be able to
    // reach the fields that approval and the dossier own.
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    });
    const transform = (body: Record<string, unknown>) =>
      pipe.transform(body, { type: 'body', metatype: UpdateMeChefProfileDto });

    it('accepts a partial body — nothing is required for an update', async () => {
      await expect(transform({ bio: 'Nouvelle bio' })).resolves.toEqual({
        bio: 'Nouvelle bio',
      });
    });

    it('refuses to blank the display name', async () => {
      await expect(transform({ displayName: '' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it.each([
      ['isActive', true],
      ['isVerified', true],
      ['role', 'admin'],
      ['stripeAccountId', 'acct_123'],
      ['cronofyProfileId', 'cr_123'],
      ['sapPath', 'type_a'],
      ['interventionZones', []],
      ['autoSuspendedAt', null],
      ['avatarUrl', 'https://elsewhere.example/me.jpg'],
    ])('refuses %s, which a chef must never set on themselves', async (field, value) => {
      await expect(transform({ [field]: value })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  it('delegates chef vetting to the service', async () => {
    await expect(
      controller.updateChefVerification('chef-1', { isVerified: true, isActive: true }),
    ).resolves.toMatchObject({ isVerified: true });

    expect(users.setChefVerification).toHaveBeenCalledWith('chef-1', {
      isVerified: true,
      isActive: true,
    });
  });

  it('forwards the client list query and returns the paginated envelope', async () => {
    const query: ListAdminClientsQueryDto = {
      page: 2,
      limit: 10,
      status: ClientProfileStatus.vip,
    };

    await expect(controller.listClients(query)).resolves.toEqual({
      data: [],
      meta: expect.objectContaining({ page: 2, limit: 10, hasPreviousPage: true }),
    });
    expect(users.listClients).toHaveBeenCalledWith(query);
  });

  it('forwards the account list query', async () => {
    await controller.listUsers({ page: 1, limit: 100 });

    expect(users.listUsers).toHaveBeenCalledWith({ page: 1, limit: 100 });
  });

  describe('ListAdminClientsQueryDto under the global validation pipe', () => {
    // Mirrors the pipe configured in `main.ts`, so these assertions describe what
    // an actual `GET /admin/clients?...` request does, not just the decorators.
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    });

    const transform = (query: Record<string, unknown>) =>
      pipe.transform(query, {
        type: 'query',
        metatype: ListAdminClientsQueryDto,
      }) as Promise<ListAdminClientsQueryDto>;

    it('coerces the query string page and limit to numbers', async () => {
      // Query params always arrive as strings; without coercion Prisma would be
      // handed a non-numeric `skip`/`take`.
      await expect(transform({ page: '3', limit: '50' })).resolves.toEqual({
        page: 3,
        limit: 50,
      });
    });

    it('leaves page and limit unset when omitted, so the service defaults apply', async () => {
      const dto = await transform({});

      expect(dto.page).toBeUndefined();
      expect(dto.limit).toBeUndefined();
    });

    it.each([
      ['page below 1', { page: '0' }, 'page'],
      ['a non-numeric page', { page: 'abc' }, 'page'],
      ['limit above the cap', { limit: '101' }, 'limit'],
      ['a fractional limit', { limit: '2.5' }, 'limit'],
      ['an unknown status', { status: 'churned' }, 'status'],
      ['an unsupported parameter', { sort: 'name' }, 'sort'],
    ])('rejects %s', async (_label, query, mentioned) => {
      const error = await transform(query).then(
        () => null,
        (e: BadRequestException) => e,
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(JSON.stringify(error?.getResponse())).toMatch(mentioned);
    });
  });
});
