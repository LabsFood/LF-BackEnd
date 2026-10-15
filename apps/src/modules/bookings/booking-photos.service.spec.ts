import { R2StorageService } from '../../integrations/r2-storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { BookingPhotosService, MAX_BOOKING_PHOTOS } from './booking-photos.service';

describe('BookingPhotosService', () => {
  let prisma: {
    booking: { findFirst: jest.Mock };
    bookingPhoto: Record<string, jest.Mock>;
  };
  let storage: Record<string, jest.Mock>;
  let service: BookingPhotosService;

  const upload = { contentType: 'image/jpeg', sizeBytes: 1000 };

  beforeEach(() => {
    prisma = {
      booking: {
        findFirst: jest.fn().mockResolvedValue({ id: 'b1', status: 'cooking' }),
      },
      bookingPhoto: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'p1' }),
        findFirst: jest.fn(),
        delete: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    storage = {
      presignPhoto: jest.fn().mockResolvedValue({ uploadId: 'ph_x' }),
      confirmPhoto: jest
        .fn()
        .mockResolvedValue({ key: 'k', url: 'https://p/bookings/b1/ph_x.jpg' }),
      ownedKey: jest.fn().mockReturnValue('bookings/b1/ph_x.jpg'),
      delete: jest.fn(),
    };
    const users = {
      chefIdentity: jest
        .fn()
        .mockResolvedValue({ userId: 'u1', chefProfileId: 'chef-1' }),
    };
    service = new BookingPhotosService(
      prisma as unknown as PrismaService,
      users as unknown as UsersService,
      storage as unknown as R2StorageService,
    );
  });

  it('files the upload under the booking, for its batch cooker only', async () => {
    await service.uploadUrl('clerk_1', 'b1', upload);

    expect(prisma.booking.findFirst.mock.calls[0][0].where).toEqual({
      id: 'b1',
      chefProfileId: 'chef-1',
    });
    expect(storage.presignPhoto).toHaveBeenCalledWith('bookings/b1/', 'image/jpeg', 1000);
  });

  it('waits for the prestation to start', async () => {
    prisma.booking.findFirst.mockResolvedValue({ id: 'b1', status: 'confirmed' });

    await expect(service.uploadUrl('clerk_1', 'b1', upload)).rejects.toMatchObject({
      response: { code: 'NOT_STARTED' },
    });
  });

  it('still takes photos during a dispute: they are evidence', async () => {
    prisma.booking.findFirst.mockResolvedValue({ id: 'b1', status: 'disputed' });

    await service.uploadUrl('clerk_1', 'b1', upload);

    expect(storage.presignPhoto).toHaveBeenCalled();
  });

  it(`keeps ${MAX_BOOKING_PHOTOS} photos at most`, async () => {
    prisma.bookingPhoto.count.mockResolvedValue(MAX_BOOKING_PHOTOS);

    await expect(service.uploadUrl('clerk_1', 'b1', upload)).rejects.toMatchObject({
      response: { code: 'TOO_MANY_PHOTOS' },
    });
  });

  it('answers 404 for another batch cooker’s booking', async () => {
    prisma.booking.findFirst.mockResolvedValue(null);

    await expect(service.uploadUrl('clerk_1', 'b1', upload)).rejects.toMatchObject({
      response: { code: 'BOOKING_NOT_FOUND' },
    });
  });

  it('adds the checked photo with its caption', async () => {
    await service.add('clerk_1', 'b1', {
      ...upload,
      uploadId: 'ph_x',
      caption: 'Bocaux',
    });

    expect(prisma.bookingPhoto.create).toHaveBeenCalledWith({
      data: { bookingId: 'b1', url: 'https://p/bookings/b1/ph_x.jpg', caption: 'Bocaux' },
      select: { id: true },
    });
  });

  it('removes a photo and its file', async () => {
    prisma.bookingPhoto.findFirst.mockResolvedValue({
      id: 'p1',
      url: 'https://p/bookings/b1/ph_x.jpg',
    });

    await service.remove('clerk_1', 'b1', 'p1');

    expect(prisma.bookingPhoto.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
    expect(storage.delete).toHaveBeenCalledWith('bookings/b1/ph_x.jpg');
  });
});
