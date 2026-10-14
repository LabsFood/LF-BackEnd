import { ExecutionContext, ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';

import { ClerkAuthGuard } from '../../auth/clerk-auth.guard';
import { UserRole } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ShoppingListsService } from '../shopping-lists/shopping-lists.service';
import { AdminBookingsController } from './admin-bookings.controller';
import { BookingPhotosService } from './booking-photos.service';
import { BookingsService } from './bookings.service';
import { ChefBookingsController } from './chef-bookings.controller';
import { MeBookingsController } from './me-bookings.controller';

const ID = '7b1ebc99-9c0b-4ef8-bb6d-6bb9bd380a88';

describe('Bookings by audience (routes)', () => {
  let app: NestFastifyApplication;
  let bookings: Record<string, jest.Mock>;
  let findUser: jest.Mock;

  beforeEach(async () => {
    bookings = {
      listFor: jest.fn().mockResolvedValue({ data: [], meta: {} }),
      detailFor: jest.fn().mockResolvedValue({ id: ID }),
      update: jest.fn().mockResolvedValue({ id: ID }),
    };
    findUser = jest.fn();

    // Only the Clerk session check is faked: AdminGuard and the validation pipe are
    // the real ones, so the wiring of each audience is what's under test.
    const moduleRef = await Test.createTestingModule({
      controllers: [
        MeBookingsController,
        ChefBookingsController,
        AdminBookingsController,
      ],
      providers: [
        { provide: BookingsService, useValue: bookings },
        { provide: BookingPhotosService, useValue: {} },
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

  it.each([UserRole.client, UserRole.chef])(
    'keeps a signed-in %s out of /admin/bookings',
    async (role) => {
      findUser.mockResolvedValue({ role });

      const res = await app.inject({ method: 'GET', url: '/admin/bookings' });

      expect(res.statusCode).toBe(403);
      expect(bookings.listFor).not.toHaveBeenCalled();
    },
  );

  it('lists every booking for an admin, with the admin filters', async () => {
    findUser.mockResolvedValue({ role: UserRole.admin });

    const res = await app.inject({
      method: 'GET',
      url: `/admin/bookings?chefId=${ID}&status=confirmed`,
    });

    expect(res.statusCode).toBe(200);
    expect(bookings.listFor).toHaveBeenCalledWith(
      'admin',
      'user_1',
      expect.objectContaining({ chefId: ID, status: 'confirmed' }),
    );
  });

  it('refuses another audience’s filter: a client cannot ask for a batch cooker', async () => {
    const res = await app.inject({ method: 'GET', url: `/me/bookings?chefId=${ID}` });

    expect(res.statusCode).toBe(400);
  });

  it('refuses a booking id that is not a uuid', async () => {
    const res = await app.inject({ method: 'GET', url: '/me/bookings/not-a-uuid' });

    expect(res.statusCode).toBe(400);
    expect(bookings.detailFor).not.toHaveBeenCalled();
  });

  it('lets a batch cooker change the status only', async () => {
    const moved = await app.inject({
      method: 'PATCH',
      url: `/chef/bookings/${ID}`,
      payload: { status: 'cooking' },
    });
    const edited = await app.inject({
      method: 'PATCH',
      url: `/chef/bookings/${ID}`,
      payload: { status: 'cooking', startsAt: '2030-03-12T08:00:00.000Z' },
    });

    expect(moved.statusCode).toBe(200);
    expect(bookings.update).toHaveBeenCalledWith('chef', 'user_1', ID, {
      status: 'cooking',
    });
    expect(edited.statusCode).toBe(400);
  });

  it('never lets a client set a status other than cancelled or completed', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/me/bookings/${ID}`,
      payload: { status: 'confirmed' },
    });

    expect(res.statusCode).toBe(400);
  });
});
