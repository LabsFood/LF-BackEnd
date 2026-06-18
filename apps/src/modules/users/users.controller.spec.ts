import { Test } from '@nestjs/testing';

import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard } from '../../auth/clerk-auth.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  let users: jest.Mocked<Pick<UsersService, 'createUser' | 'createAdmin'>>;

  const sampleUser = {
    id: 'user_1',
    clerkUserId: 'clerk_1',
    email: 'client@example.com',
    fullName: 'Client One',
    role: 'client',
  };

  beforeEach(async () => {
    users = {
      createUser: jest.fn().mockResolvedValue(sampleUser),
      createAdmin: jest.fn().mockResolvedValue({ ...sampleUser, role: 'admin' }),
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

  it('creates a client user through the service', async () => {
    const payload: CreateUserDto = {
      clerkUserId: 'clerk_1',
      email: 'client@example.com',
      fullName: 'Client One',
    };

    await expect(controller.createUser(payload)).resolves.toEqual(sampleUser);
    expect(users.createUser).toHaveBeenCalledWith(payload);
  });

  it('creates an admin user through the service', async () => {
    const payload: CreateUserDto = {
      clerkUserId: 'clerk_admin',
      email: 'admin@example.com',
      fullName: 'Admin One',
    };

    await expect(controller.createAdmin(payload)).resolves.toEqual({ ...sampleUser, role: 'admin' });
    expect(users.createAdmin).toHaveBeenCalledWith(payload);
  });
});