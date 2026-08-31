import { NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';

const payload: CreateBookingDto = {
  providerId: 'chef-1',
  serviceOfferId: 'offer-1',
  startsAt: new Date('2026-07-15T18:00:00.000Z'),
  endsAt: new Date('2026-07-15T20:00:00.000Z'),
  priceCents: 12_500,
  currency: 'EUR',
};

describe('BookingsService', () => {
  let prisma: {
    booking: { create: jest.Mock; count: jest.Mock; findMany: jest.Mock };
    chefProfile: { findUnique: jest.Mock };
    serviceOffer: { findUnique: jest.Mock };
  };
  let users: { ensurePersistedFromClerk: jest.Mock };
  let service: BookingsService;

  beforeEach(() => {
    prisma = {
      booking: {
        create: jest.fn((args: unknown) => Promise.resolve(args)),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn(),
      },
      chefProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'chef-1' }) },
      serviceOffer: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'offer-1', chefProfileId: 'chef-1' }),
      },
    };
    users = {
      ensurePersistedFromClerk: jest.fn().mockResolvedValue({ id: 'user-1' }),
    };
    service = new BookingsService(
      prisma as unknown as PrismaService,
      users as unknown as UsersService,
    );
  });

  describe('create', () => {
    it('persists a pending booking with the 50 % tax-credit amount', async () => {
      await service.create('clerk_1', payload);

      expect(prisma.booking.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          clientId: 'user-1',
          chefProfileId: 'chef-1',
          serviceOfferId: 'offer-1',
          status: 'pending',
          priceCents: 12_500,
          amountTtc: 12_500,
          amountAfterTax: 6_250,
          currency: 'EUR',
        }),
      });
    });

    it('rounds an odd amount when halving it', async () => {
      await service.create('clerk_1', { ...payload, priceCents: 12_501 });

      expect(prisma.booking.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ amountTtc: 12_501, amountAfterTax: 6_251 }),
      });
    });

    it('numbers the reference from the count of the current year', async () => {
      const year = new Date().getUTCFullYear();
      prisma.booking.count.mockResolvedValue(41);

      await service.create('clerk_1', payload);

      expect(prisma.booking.count).toHaveBeenCalledWith({
        where: { reference: { startsWith: `LF-${year}-` } },
      });
      expect(prisma.booking.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ reference: `LF-${year}-0042` }),
      });
    });

    it('prefers chefId over the legacy providerId', async () => {
      prisma.chefProfile.findUnique.mockResolvedValue({ id: 'chef-2' });

      await service.create('clerk_1', { ...payload, chefId: 'chef-2' });

      expect(prisma.chefProfile.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'chef-2' } }),
      );
    });

    it('404s on an unknown chef profile', async () => {
      prisma.chefProfile.findUnique.mockResolvedValue(null);

      await expect(service.create('clerk_1', payload)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.booking.create).not.toHaveBeenCalled();
    });

    it('404s on an unknown service offer', async () => {
      prisma.serviceOffer.findUnique.mockResolvedValue(null);

      await expect(service.create('clerk_1', payload)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.booking.create).not.toHaveBeenCalled();
    });
  });
});
