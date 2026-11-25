import { Injectable, NotFoundException } from '@nestjs/common';

import { MealStatus } from '../../generated/prisma/client';
import { R2StorageService } from '../../integrations/r2-storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { fridgeAlertDaysInForce } from '../platform-settings/fridge-alert';
import { ChefContentService, MENU_DISHES } from './chef-content.service';
import { goneMeanwhile } from './dishes.service';
import { toDishView } from './dishes.views';
import { contentNotOwned } from './domain/content.errors';
import { nextReviewReason, reviewFields } from './domain/moderation.rules';
import { PhotoConfirmDto, PhotoUploadDto } from './dto/photo.dto';
import { toAdminMenuView } from './labs-food-content.service';
import { toMenuView } from './menus.service';

export type PhotoKind = 'dish' | 'menu';

const plural = (kind: PhotoKind) => (kind === 'dish' ? 'dishes' : 'menus');

/**
 * Where a batch cooker's photo lives: under the chef and the dish or menu, so the
 * upload path cannot be used to place a file anywhere else (PRD).
 */
export const chefPhotoFolder = (chefId: string, kind: PhotoKind, id: string) =>
  `chefs/${chefId}/${plural(kind)}/${id}/`;

/** Where a Lab's Food dish or menu photo lives, set by an admin. */
const labsFoodPhotoFolder = (kind: PhotoKind, id: string) =>
  `labsfood/${plural(kind)}/${id}/`;

/**
 * Dish and menu photos (FLOW-02 milestone 7). The same three steps as KYC
 * documents: a presigned URL, a PUT straight to storage, then a confirm the API
 * checks.
 *
 * A batch cooker's photo is moderated with the content: a new one sends a
 * reviewed dish or menu back to the queue, and suspending it takes the photo down.
 * An admin sets the photos of Lab's Food's own dishes and menus, the suggestions
 * chefs adopt; an adopted copy shares the suggestion's file.
 */
@Injectable()
export class ContentPhotosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ChefContentService,
    private readonly storage: R2StorageService,
  ) {}

  /** The console's fridge threshold, for the `FRIDGE_LONG` warning of a dish view. */
  private fridgeDays() {
    return fridgeAlertDaysInForce(this.prisma);
  }

  // ------------------------------------------------- a batch cooker's own content

  async uploadUrl(
    clerkUserId: string,
    kind: PhotoKind,
    id: string,
    payload: PhotoUploadDto,
  ) {
    const { folder } = await this.chefItem(clerkUserId, kind, id);
    return this.storage.presignPhoto(folder, payload.contentType, payload.sizeBytes);
  }

  /** Checks what landed, then makes it the photo. The previous one is deleted. */
  async confirm(
    clerkUserId: string,
    kind: PhotoKind,
    id: string,
    payload: PhotoConfirmDto,
  ) {
    const { chefId, item, folder } = await this.chefItem(clerkUserId, kind, id);
    const { key, url } = await this.storage.confirmPhoto(
      folder,
      payload.uploadId,
      payload.contentType,
    );
    const view = await this.saveChefs(kind, chefId, item.id, {
      imageUrl: url,
      // A new photo on public (or already reviewed) content: admins look again.
      ...((item.status === MealStatus.published || item.reviewedAt) &&
        reviewFields(item, nextReviewReason(item, 'edited'), new Date())),
    });
    await this.dropPrevious(item.imageUrl, folder, key);
    return view;
  }

  /** Removes the photo; the dish or menu stays as it is otherwise. */
  async remove(clerkUserId: string, kind: PhotoKind, id: string) {
    const { chefId, item, folder } = await this.chefItem(clerkUserId, kind, id);
    const view = await this.saveChefs(kind, chefId, item.id, { imageUrl: null });
    await this.dropPrevious(item.imageUrl, folder);
    return view;
  }

  private async chefItem(clerkUserId: string, kind: PhotoKind, id: string) {
    const chef = await this.access.chef(clerkUserId);
    this.access.assertVerified(chef);
    const item =
      kind === 'dish'
        ? await this.access.writableDish(chef, id)
        : await this.access.writableMenu(chef, id);
    return { chefId: chef.id, item, folder: chefPhotoFolder(chef.id, kind, item.id) };
  }

  private async saveChefs(
    kind: PhotoKind,
    chefId: string,
    id: string,
    data: { imageUrl: string | null },
  ) {
    const where = { id, chefProfileId: chefId };
    return kind === 'dish'
      ? toDishView(
          await this.prisma.meal.update({ where, data }).catch(goneMeanwhile('Dish')),
          await this.fridgeDays(),
        )
      : toMenuView(
          await this.prisma.menu
            .update({ where, data, include: MENU_DISHES })
            .catch(goneMeanwhile('Menu')),
          await this.fridgeDays(),
        );
  }

  // ------------------------------------------- Lab's Food's own content (admin)

  async adminUploadUrl(kind: PhotoKind, id: string, payload: PhotoUploadDto) {
    await this.labsFoodItem(kind, id);
    return this.storage.presignPhoto(
      labsFoodPhotoFolder(kind, id),
      payload.contentType,
      payload.sizeBytes,
    );
  }

  async adminConfirm(kind: PhotoKind, id: string, payload: PhotoConfirmDto) {
    const item = await this.labsFoodItem(kind, id);
    const folder = labsFoodPhotoFolder(kind, id);
    const { key, url } = await this.storage.confirmPhoto(
      folder,
      payload.uploadId,
      payload.contentType,
    );
    const view = await this.saveLabsFoods(kind, id, { imageUrl: url });
    await this.dropPrevious(item.imageUrl, folder, key);
    return view;
  }

  async adminRemove(kind: PhotoKind, id: string) {
    const item = await this.labsFoodItem(kind, id);
    const view = await this.saveLabsFoods(kind, id, { imageUrl: null });
    await this.dropPrevious(item.imageUrl, labsFoodPhotoFolder(kind, id));
    return view;
  }

  /** A Lab's Food dish or menu; a batch cooker's is not an admin's to illustrate. */
  private async labsFoodItem(kind: PhotoKind, id: string) {
    const select = { chefProfileId: true, imageUrl: true } as const;
    const item =
      kind === 'dish'
        ? await this.prisma.meal.findUnique({ where: { id }, select })
        : await this.prisma.menu.findUnique({ where: { id }, select });
    if (!item)
      throw new NotFoundException(
        kind === 'dish' ? 'Meal not found.' : 'Menu not found.',
      );
    if (item.chefProfileId) {
      throw contentNotOwned(
        `This ${kind === 'dish' ? 'meal' : 'menu'} belongs to a batch cooker.`,
      );
    }
    return item;
  }

  /** The admin routes answer as `/admin/meals` and `/admin/menus` do. */
  private async saveLabsFoods(
    kind: PhotoKind,
    id: string,
    data: { imageUrl: string | null },
  ) {
    const where = { id, chefProfileId: null };
    return kind === 'dish'
      ? this.prisma.meal.update({ where, data }).catch(goneMeanwhile('Dish'))
      : toAdminMenuView(
          await this.prisma.menu
            .update({ where, data, include: MENU_DISHES })
            .catch(goneMeanwhile('Menu')),
          await this.fridgeDays(),
        );
  }

  // ------------------------------------------------------------------- shared

  /**
   * Deletes a replaced photo only if it lives under this content's folder and no
   * dish or menu still shows it: a chef's copy of a Lab's Food suggestion points
   * at the suggestion's file.
   */
  private async dropPrevious(previousUrl: string | null, folder: string, keep?: string) {
    const key = this.storage.ownedKey(previousUrl, folder);
    if (!key || key === keep) return;
    const [meals, menus] = await Promise.all([
      this.prisma.meal.count({ where: { imageUrl: previousUrl } }),
      this.prisma.menu.count({ where: { imageUrl: previousUrl } }),
    ]);
    if (meals + menus === 0) await this.storage.delete(key);
  }
}
