import { Injectable, NotFoundException } from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { R2StorageService } from '../../integrations/r2-storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PhotoConfirmDto, PhotoUploadDto } from '../dishes/dto/photo.dto';

/** Always under the account itself, so the upload cannot place a file elsewhere. */
const avatarFolder = (userId: string) => `users/${userId}/avatar/`;

type Account = { id: string; avatarUrl: string | null };

/**
 * The profile photo of any account — client, batch cooker (a candidate included)
 * or admin — on R2 like dish photos and through the same three steps. A batch
 * cooker's shows on their public page once they are listed; an admin can take any
 * of them down.
 */
@Injectable()
export class AvatarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: R2StorageService,
    private readonly audit: AuditService,
  ) {}

  private async account(where: { id: string } | { clerkUserId: string }) {
    const user = await this.prisma.user.findUnique({
      where,
      select: { id: true, avatarUrl: true },
    });
    if (!user) throw new NotFoundException('No account with this id.');
    return user;
  }

  async uploadUrl(clerkUserId: string, payload: PhotoUploadDto) {
    const user = await this.account({ clerkUserId });
    return this.storage.presignPhoto(
      avatarFolder(user.id),
      payload.contentType,
      payload.sizeBytes,
    );
  }

  /** Checks what landed, then makes it the photo. The previous one is deleted. */
  async confirm(clerkUserId: string, payload: PhotoConfirmDto) {
    const user = await this.account({ clerkUserId });
    const { key, url } = await this.storage.confirmPhoto(
      avatarFolder(user.id),
      payload.uploadId,
      payload.contentType,
    );
    await this.prisma.user.update({ where: { id: user.id }, data: { avatarUrl: url } });
    const previous = this.storage.ownedKey(user.avatarUrl, avatarFolder(user.id));
    if (previous && previous !== key) await this.storage.delete(previous);
    return { avatarUrl: url };
  }

  /** `DELETE /me/avatar`. */
  async removeOwn(clerkUserId: string) {
    return this.clear(await this.account({ clerkUserId }));
  }

  /** `DELETE /admin/users/:id/avatar` — moderation, so it is on the record. */
  async takeDown(userId: string, adminUserId: string) {
    const result = await this.clear(await this.account({ id: userId }));
    await this.audit.record({
      actorType: 'admin',
      actorUserId: adminUserId,
      action: 'user.avatar_removed',
      subjectType: 'user',
      subjectId: userId,
    });
    return result;
  }

  private async clear(user: Account) {
    await this.prisma.user.update({ where: { id: user.id }, data: { avatarUrl: null } });
    const previous = this.storage.ownedKey(user.avatarUrl, avatarFolder(user.id));
    if (previous) await this.storage.delete(previous);
    return { avatarUrl: null };
  }
}
