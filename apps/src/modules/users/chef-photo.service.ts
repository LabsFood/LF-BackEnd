import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import { AuditService } from '../../common/audit/audit.service';
import { PHOTO_TYPES, R2StorageService } from '../../integrations/r2-storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PhotoConfirmDto, PhotoUploadDto } from '../dishes/dto/photo.dto';

/** Always under the chef's own profile, so the upload cannot place a file elsewhere. */
const avatarPrefix = (chefId: string) => `chefs/${chefId}/avatar/`;

const avatarKey = (chefId: string, uploadId: string, contentType: string) =>
  `${avatarPrefix(chefId)}${uploadId}.${PHOTO_TYPES[contentType]}`;

type ProfilePhoto = { id: string; avatarUrl: string | null };

/**
 * A batch cooker's profile photo, on R2 like dish photos and through the same three
 * steps: a presigned URL, a `PUT` straight to storage, then a confirm the API checks.
 *
 * Open to a candidate awaiting approval too (decided 03/10/2026): besides the
 * dossier, the photo is the one thing they may set — dishes and menus still wait
 * for approval. It shows publicly only once the chef is listed, and an admin can
 * take it down.
 */
@Injectable()
export class ChefPhotoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: R2StorageService,
    private readonly audit: AuditService,
  ) {}

  /** The caller's own chef profile, verified or not. */
  private async own(clerkUserId: string): Promise<ProfilePhoto> {
    const profile = await this.prisma.chefProfile.findFirst({
      where: { user: { clerkUserId } },
      select: { id: true, avatarUrl: true },
    });
    if (!profile) {
      throw new NotFoundException('No batch cooker profile for this account.');
    }
    return profile;
  }

  async uploadUrl(clerkUserId: string, payload: PhotoUploadDto) {
    const profile = await this.own(clerkUserId);
    this.storage.assertAcceptable(payload.contentType, payload.sizeBytes);

    const uploadId = `ph_${randomBytes(12).toString('hex')}`;
    const signed = await this.storage.createUploadUrl(
      avatarKey(profile.id, uploadId, payload.contentType),
      payload.contentType,
      payload.sizeBytes,
    );
    return { uploadId, ...signed };
  }

  /** Checks what landed, then makes it the photo. The previous one is deleted. */
  async confirm(clerkUserId: string, payload: PhotoConfirmDto) {
    const profile = await this.own(clerkUserId);
    const key = avatarKey(profile.id, payload.uploadId, payload.contentType);
    await this.storage.assertUploaded(key, payload.contentType);

    const updated = await this.prisma.chefProfile.update({
      where: { id: profile.id },
      data: { avatarUrl: this.storage.publicUrl(key) },
    });
    const previous = this.ownKey(profile);
    if (previous && previous !== key) await this.storage.delete(previous);
    return updated;
  }

  /** `DELETE /me/chef-profile/photo`. */
  async removeOwn(clerkUserId: string) {
    return this.clear(await this.own(clerkUserId));
  }

  /** `DELETE /admin/chefs/:id/photo` — moderation, so it is on the record. */
  async takeDown(chefProfileId: string, adminUserId: string) {
    const profile = await this.prisma.chefProfile.findUnique({
      where: { id: chefProfileId },
      select: { id: true, avatarUrl: true },
    });
    if (!profile) throw new NotFoundException('No batch cooker page with this id.');

    const updated = await this.clear(profile);
    await this.audit.record({
      actorType: 'admin',
      actorUserId: adminUserId,
      action: 'chef.photo_removed',
      subjectType: 'chef_profile',
      subjectId: chefProfileId,
    });
    return updated;
  }

  private async clear(profile: ProfilePhoto) {
    const updated = await this.prisma.chefProfile.update({
      where: { id: profile.id },
      data: { avatarUrl: null },
    });
    const previous = this.ownKey(profile);
    if (previous) await this.storage.delete(previous);
    return updated;
  }

  /** The photo's key, only if it is this profile's own: nothing else is ever deleted. */
  private ownKey(profile: ProfilePhoto): string | null {
    const key = this.storage.keyOf(profile.avatarUrl);
    return key?.startsWith(avatarPrefix(profile.id)) ? key : null;
  }
}
