import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import { MealStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ChefContentService } from './chef-content.service';
import { goneMeanwhile } from './dishes.service';
import { toDishView } from './dishes.views';
import { nextReviewReason, reviewFields } from './domain/moderation.rules';
import { PhotoConfirmDto, PhotoUploadDto } from './dto/photo.dto';
import { MAX_PHOTO_BYTES, PHOTO_TYPES, R2StorageService } from './r2-storage.service';

/**
 * Where a photo lives: always under the owning chef and the dish, so the upload
 * path cannot be used to place a file anywhere else (PRD).
 */
const photoKey = (
  chefId: string,
  dishId: string,
  uploadId: string,
  contentType: string,
) => `chefs/${chefId}/dishes/${dishId}/${uploadId}.${PHOTO_TYPES[contentType]}`;

/**
 * Dish photos (FLOW-02 milestone 7). The same three steps as KYC documents: a
 * presigned URL, a PUT straight to storage, then a confirm the API checks. The
 * photo is moderated with the dish: a new one sends a reviewed dish back to the
 * queue, and suspending the dish takes its photo down with it.
 */
@Injectable()
export class DishPhotosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ChefContentService,
    private readonly storage: R2StorageService,
  ) {}

  async uploadUrl(clerkUserId: string, dishId: string, payload: PhotoUploadDto) {
    const chef = await this.access.chef(clerkUserId);
    this.access.assertVerified(chef);
    const dish = await this.access.writableDish(chef, dishId);
    this.storage.assertAcceptable(payload.contentType, payload.sizeBytes);

    const uploadId = `ph_${randomBytes(12).toString('hex')}`;
    const signed = await this.storage.createUploadUrl(
      photoKey(chef.id, dish.id, uploadId, payload.contentType),
      payload.contentType,
      payload.sizeBytes,
    );
    return { uploadId, ...signed };
  }

  /**
   * Checks the file really landed, under this dish, with the type and size
   * allowed, then makes it the dish's photo. The previous photo is deleted.
   */
  async confirm(clerkUserId: string, dishId: string, payload: PhotoConfirmDto) {
    const chef = await this.access.chef(clerkUserId);
    this.access.assertVerified(chef);
    const dish = await this.access.writableDish(chef, dishId);
    const key = photoKey(chef.id, dish.id, payload.uploadId, payload.contentType);

    const object = await this.storage.head(key);
    if (!object) {
      throw new ConflictException({
        code: 'UPLOAD_NOT_CONFIRMED',
        message: 'No uploaded file was found for this upload id.',
      });
    }
    if (
      object.sizeBytes > MAX_PHOTO_BYTES ||
      object.contentType !== payload.contentType ||
      (await this.storage.sniff(key)) !== payload.contentType
    ) {
      await this.storage.delete(key);
      throw new UnprocessableEntityException({
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'The file sent does not match the type and size announced.',
      });
    }

    const previous = this.ownKey(chef.id, dish.id, dish.imageUrl);
    const updated = await this.prisma.meal
      .update({
        where: { id: dish.id, chefProfileId: chef.id },
        data: {
          imageUrl: this.storage.publicUrl(key),
          // A new photo on a public (or already reviewed) dish: admins look again.
          ...((dish.status === MealStatus.published || dish.reviewedAt) &&
            reviewFields(dish, nextReviewReason(dish, 'edited'), new Date())),
        },
      })
      .catch(goneMeanwhile('Dish'));
    if (previous && previous !== key) await this.storage.delete(previous);
    return toDishView(updated);
  }

  /** Removes the photo; the dish stays as it is otherwise. */
  async remove(clerkUserId: string, dishId: string) {
    const chef = await this.access.chef(clerkUserId);
    this.access.assertVerified(chef);
    const dish = await this.access.writableDish(chef, dishId);
    const updated = await this.prisma.meal
      .update({
        where: { id: dish.id, chefProfileId: chef.id },
        data: { imageUrl: null },
      })
      .catch(goneMeanwhile('Dish'));
    const previous = this.ownKey(chef.id, dish.id, dish.imageUrl);
    if (previous) await this.storage.delete(previous);
    return toDishView(updated);
  }

  /** The photo's key, only if it is this dish's own: nothing else is ever deleted. */
  private ownKey(chefId: string, dishId: string, url: string | null): string | null {
    const key = this.storage.keyOf(url);
    return key?.startsWith(`chefs/${chefId}/dishes/${dishId}/`) ? key : null;
  }
}
