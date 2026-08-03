import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { UserRole } from '../../generated/prisma/client';
import { RegisterUserDto } from './dto/register-user.dto';
import { PublicUsersController } from './public-users.controller';
import { UsersService } from './users.service';

describe('PublicUsersController', () => {
  let controller: PublicUsersController;
  let users: jest.Mocked<Pick<UsersService, 'registerClient'>>;

  beforeEach(async () => {
    users = {
      registerClient: jest.fn().mockResolvedValue({
        user: {
          id: 'uuid-1',
          clerkUserId: 'user_new',
          email: 'new@example.com',
          fullName: null,
          phone: null,
          role: UserRole.client,
        },
        signInToken: 'sit_abc123',
        expiresInSeconds: 60,
      }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [PublicUsersController],
      providers: [{ provide: UsersService, useValue: users }],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(PublicUsersController);
  });

  it('registers a client and returns the sign-in ticket', async () => {
    const result = await controller.register({
      email: 'new@example.com',
      password: 'Str0ng!UniquePass',
    });

    expect(users.registerClient).toHaveBeenCalledWith({
      email: 'new@example.com',
      password: 'Str0ng!UniquePass',
    });
    expect(result.user.role).toBe(UserRole.client);
    expect(result.signInToken).toBe('sit_abc123');
    expect(result.expiresInSeconds).toBe(60);
  });

  it('forwards only email and password to the service', async () => {
    await controller.register({
      email: 'new@example.com',
      password: 'Str0ng!UniquePass',
      role: 'admin',
    } as never);

    expect(users.registerClient).toHaveBeenCalledWith({
      email: 'new@example.com',
      password: 'Str0ng!UniquePass',
    });
  });

  describe('RegisterUserDto validation', () => {
    const validateBody = (body: Record<string, unknown>) =>
      validate(plainToInstance(RegisterUserDto, body));

    it('accepts a strong password', async () => {
      const errors = await validateBody({
        email: 'new@example.com',
        password: 'Str0ng!UniquePass',
      });
      expect(errors).toHaveLength(0);
    });

    it.each([
      ['too short', 'Ab1!xyz'],
      ['no symbol', 'Str0ngUniquePass'],
      ['no uppercase', 'str0ng!uniquepass'],
      ['no number', 'Strong!UniquePass'],
    ])('rejects a password with %s', async (_label, password) => {
      const errors = await validateBody({ email: 'new@example.com', password });
      expect(errors.map((e) => e.property)).toContain('password');
    });

    it('rejects a malformed email', async () => {
      const errors = await validateBody({
        email: 'not-an-email',
        password: 'Str0ng!UniquePass',
      });
      expect(errors.map((e) => e.property)).toContain('email');
    });

    it('rejects a submitted role under the global whitelist pipe', async () => {
      const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true });

      // Privilege escalation is closed by omission: `role` is not on the DTO, so the
      // globally configured pipe rejects it outright rather than silently dropping it.
      const error = await pipe
        .transform(
          { email: 'new@example.com', password: 'Str0ng!UniquePass', role: 'admin' },
          { type: 'body', metatype: RegisterUserDto },
        )
        .then(
          () => null,
          (e: BadRequestException) => e,
        );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(JSON.stringify(error?.getResponse())).toMatch(/role/);
    });
  });
});
