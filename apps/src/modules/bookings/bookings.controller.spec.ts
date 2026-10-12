import { ConflictException, ExecutionContext, ValidationPipe } from '@nestjs/common';
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
  let bookings: jest.Mocked<Pick<BookingsService, 'list' | 'assertNotOwnChef'>>;
  let findUser: jest.Mock;

  beforeEach(async () => {
    bookings = {
      list: jest.fn().mockResolvedValue([]),
      assertNotOwnChef: jest.fn().mockResolvedValue(undefined),
    };
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
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
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

  describe('POST /bookings', () => {
    const body = {
      providerId: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
      chefId: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
      serviceOfferId: '9c3ebc99-9c0b-4ef8-bb6d-6bb9bd380a99',
      startsAt: '2026-11-15T18:00:00.000Z',
      endsAt: '2026-11-15T20:00:00.000Z',
      priceCents: 12500,
    };
    const post = () => app.inject({ method: 'POST', url: '/bookings', payload: body });

    // Whoever builds booking creation keeps this: one account can now be both a
    // client and a batch cooker, and must never book itself.
    it('checks that the caller is not booking their own page', async () => {
      await post();
      expect(bookings.assertNotOwnChef).toHaveBeenCalledWith('user_1', body.chefId);
    });

    it('answers 409 SAME_PERSON for the caller’s own page', async () => {
      bookings.assertNotOwnChef.mockRejectedValue(
        new ConflictException({ code: 'SAME_PERSON', message: 'own page' }),
      );

      const res = await post();

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ code: 'SAME_PERSON' });
    });
  });
});
