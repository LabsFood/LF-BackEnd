import { HttpException, HttpStatus } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { ShoppingListsService } from '../shopping-lists/shopping-lists.service';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';

const clerk: ClerkUser = { userId: 'clerk_1' };

const payload: CreateBookingDto = {
  providerId: 'chef-1',
  serviceOfferId: 'offer-1',
  startsAt: new Date('2026-07-15T18:00:00.000Z'),
  endsAt: new Date('2026-07-15T20:00:00.000Z'),
  priceCents: 12_500,
  currency: 'EUR',
};

const createdBooking = {
  id: 'booking-1',
  reference: 'LF-2026-0001',
  clientId: 'user-1',
  chefProfileId: 'chef-1',
  serviceOfferId: 'offer-1',
  startsAt: payload.startsAt,
  endsAt: payload.endsAt,
  status: 'pending',
  priceCents: 12_500,
  amountTtc: 12_500,
  amountAfterTax: 6_250,
  currency: 'EUR',
};

describe('BookingsController', () => {
  let controller: BookingsController;
  let bookings: { create: jest.Mock; list: jest.Mock };

  beforeEach(async () => {
    bookings = {
      create: jest.fn().mockResolvedValue(createdBooking),
      list: jest.fn().mockResolvedValue([]),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [BookingsController],
      providers: [
        { provide: BookingsService, useValue: bookings },
        { provide: ShoppingListsService, useValue: {} },
      ],
    })
      .overrideGuard(ClerkAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(BookingsController);
  });

  it('returns the created booking with its reference and amounts', async () => {
    await expect(controller.create(payload, clerk)).resolves.toMatchObject({
      id: 'booking-1',
      reference: 'LF-2026-0001',
      amountTtc: 12_500,
      amountAfterTax: 6_250,
      chefId: 'chef-1',
      providerId: 'chef-1',
    });
    expect(bookings.create).toHaveBeenCalledWith('clerk_1', payload);
  });

  it('rejects an end date that is not after the start date', async () => {
    const invalid = { ...payload, endsAt: payload.startsAt };

    await expect(controller.create(invalid, clerk)).rejects.toMatchObject({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
    expect(bookings.create).not.toHaveBeenCalled();
  });

  it('surfaces the 422 as an HttpException', async () => {
    const invalid = { ...payload, endsAt: new Date('2026-07-15T17:00:00.000Z') };

    await expect(controller.create(invalid, clerk)).rejects.toBeInstanceOf(HttpException);
  });
});
