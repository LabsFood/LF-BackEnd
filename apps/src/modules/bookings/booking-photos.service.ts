import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import type { BookingStatus } from '../../generated/prisma/client';
import { R2StorageService } from '../../integrations/r2-storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PhotoUploadDto } from '../dishes/dto/photo.dto';
import { UsersService } from '../users/users.service';
import { BookingPhotoConfirmDto } from './dto/bookings.dto';

export const MAX_BOOKING_PHOTOS = 20;

/** From the shopping on: what a prestation leaves can be photographed. */
const STARTED: readonly BookingStatus[] = [
  'shopping',
  'cooking',
  'delivered',
  'completed',
];

/** Under the booking, so the upload link cannot place a file anywhere else. */
const folder = (bookingId: string) => `bookings/${bookingId}/`;

/**
 * What the batch cooker photographs during a prestation: plated dishes, labelled
 * containers, the kitchen handed back. The same three steps as dish photos. The
 * client and admins see them on the booking.
 *
 * ponytail: public R2 objects under an unguessable key, like dish photos: anyone
 * holding a URL can open it. Move them to a private bucket served by presigned GET
 * if that stops being acceptable.
 */
@Injectable()
export class BookingPhotosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly storage: R2StorageService,
  ) {}

  async uploadUrl(clerkUserId: string, bookingId: string, payload: PhotoUploadDto) {
    const booking = await this.startedBooking(clerkUserId, bookingId);
    await this.assertRoom(booking.id);
    return this.storage.presignPhoto(
      folder(booking.id),
      payload.contentType,
      payload.sizeBytes,
    );
  }

  /** Checks what landed, then adds it to the prestation. */
  async add(clerkUserId: string, bookingId: string, payload: BookingPhotoConfirmDto) {
    const booking = await this.startedBooking(clerkUserId, bookingId);
    await this.assertRoom(booking.id);
    const { url } = await this.storage.confirmPhoto(
      folder(booking.id),
      payload.uploadId,
      payload.contentType,
    );
    await this.prisma.bookingPhoto.create({
      data: { bookingId: booking.id, url, caption: payload.caption ?? null },
    });
    return this.list(booking.id);
  }

  async remove(clerkUserId: string, bookingId: string, photoId: string) {
    const chef = await this.users.chefIdentity(clerkUserId);
    const photo = await this.prisma.bookingPhoto.findFirst({
      where: {
        id: photoId,
        booking: { id: bookingId, chefProfileId: chef.chefProfileId },
      },
    });
    if (!photo) {
      throw new NotFoundException({
        code: 'PHOTO_NOT_FOUND',
        message: 'Photo not found.',
      });
    }
    await this.prisma.bookingPhoto.delete({ where: { id: photo.id } });
    const key = this.storage.ownedKey(photo.url, folder(bookingId));
    if (key) await this.storage.delete(key);
    return this.list(bookingId);
  }

  private async startedBooking(clerkUserId: string, bookingId: string) {
    const chef = await this.users.chefIdentity(clerkUserId);
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, chefProfileId: chef.chefProfileId },
      select: { id: true, status: true },
    });
    if (!booking) {
      throw new NotFoundException({
        code: 'BOOKING_NOT_FOUND',
        message: 'Booking not found.',
      });
    }
    if (!STARTED.includes(booking.status)) {
      throw new ConflictException({
        code: 'NOT_STARTED',
        message: 'Photos can be added once the prestation has started.',
      });
    }
    return booking;
  }

  private async assertRoom(bookingId: string) {
    const count = await this.prisma.bookingPhoto.count({ where: { bookingId } });
    if (count >= MAX_BOOKING_PHOTOS) {
      throw new ConflictException({
        code: 'TOO_MANY_PHOTOS',
        message: `A prestation keeps ${MAX_BOOKING_PHOTOS} photos at most.`,
      });
    }
  }

  private async list(bookingId: string) {
    const photos = await this.prisma.bookingPhoto.findMany({
      where: { bookingId },
      orderBy: { takenAt: 'asc' },
    });
    return photos.map((photo) => ({
      id: photo.id,
      url: photo.url,
      caption: photo.caption,
      takenAt: photo.takenAt,
    }));
  }
}
