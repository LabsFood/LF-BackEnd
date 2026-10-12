import { ExecutionContext } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { UserRole } from '../../generated/prisma/client';

import { ClerkAuthGuard } from '../../auth/clerk-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { ShoppingListsService } from '../shopping-lists/shopping-lists.service';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

describe('BookingsController', () => {
  let app: NestFastifyApplication;
  let bookings: jest.Mocked<Pick<BookingsService, 'list'>>;
  let findUser: jest.Mock;

  beforeEach(async () => {
    bookings = { list: jest.fn().mockResolvedValue([]) };
    findUser = jest.fn();

    // Only the Clerk session check is faked; the real AdminGuard runs against a
    // mocked `users` lookup, so the route's guard wiring is what's under test.
    const moduleRef = await Test.createTestingModule({
      controllers: [BookingsController],
      providers: [
        { provide: BookingsService, useValue: bookings },
        { provide: ShoppingListsService, useValue: {} },
        { provide: PrismaService, useValue: { user: { findUnique: findUser } } },
      ],
    })
      .overrideGuard(ClerkAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest().clerkUser = { userId: 'user_1' };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
      { logger: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /bookings', () => {
    it.each([UserRole.client, UserRole.chef])(
      'refuses a signed-in %s without touching the bookings table',
      async (role) => {
        findUser.mockResolvedValue({ role });

        const res = await app.inject({ method: 'GET', url: '/bookings' });

        expect(res.statusCode).toBe(403);
        expect(bookings.list).not.toHaveBeenCalled();
      },
    );

    it('lists bookings for an admin', async () => {
      findUser.mockResolvedValue({ role: UserRole.admin });

      const res = await app.inject({ method: 'GET', url: '/bookings' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
      expect(bookings.list).toHaveBeenCalled();
    });
  });
});
