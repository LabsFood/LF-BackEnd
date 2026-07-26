import { Test } from '@nestjs/testing';
import { UserRole } from '../../generated/prisma/client';

import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard } from '../../auth/clerk-auth.guard';
import { CreateAdminUserDto, UpdateUserRoleDto } from './dto/admin-user.dto';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  let users: jest.Mocked<
    Pick<UsersService, 'provisionAdminUser' | 'updateRole' | 'toUserRole'>
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
});
