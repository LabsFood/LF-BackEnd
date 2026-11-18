import { Injectable, Logger } from '@nestjs/common';

import { Meal, MealStatus, Prisma } from '../../generated/prisma/client';
import { R2StorageService } from '../../integrations/r2-storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { fridgeAlertDaysInForce } from '../platform-settings/fridge-alert';
import { ChefContentService, ChefContext, MENU_DISHES } from './chef-content.service';
import { chefPhotoFolder, PhotoKind } from './content-photos.service';
import { toDishView } from './dishes.views';
import { toMenuView } from './menus.service';

const SUFFIX = ' (copie)';

/** "[name] (copie)", shortened so the suffix fits the column. */
export const copyName = (name: string, max: number) =>
  `${name.slice(0, max - SUFFIX.length).trimEnd()}${SUFFIX}`;

/**
 * Recettes §5.4: a dish or a menu copied as a draft, never published, for the chef
 * to make a variant of. A dish copy remembers what it was copied from; its
 * allergens are to verify again and its version starts over (LF-0241). A menu copy
 * holds the same dishes: a dish can sit in several menus, none is copied.
 *
 * Photos are copied, not shared: removing or taking down one never removes the
 * other's.
 */
@Injectable()
export class DuplicationService {
  private readonly logger = new Logger(DuplicationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ChefContentService,
    private readonly storage: R2StorageService,
  ) {}

  /** The console's fridge threshold, for the `FRIDGE_LONG` warning of a dish view. */
  private fridgeDays() {
    return fridgeAlertDaysInForce(this.prisma);
  }

  async dish(clerkUserId: string, id: string) {
    const chef = await this.access.chef(clerkUserId);
    this.access.assertVerified(chef);
    const source = await this.access.readableDish(chef, id);
    const copy = await this.prisma.meal.create({ data: dishCopy(source, chef) });
    const imageUrl = await this.copyPhoto('dish', chef.id, source.imageUrl, copy.id);
    const result = imageUrl
      ? await this.prisma.meal.update({ where: { id: copy.id }, data: { imageUrl } })
      : copy;
    this.logger.log({ event: 'dish.duplicated', dishId: copy.id, variantOf: id });
    return toDishView(result, await this.fridgeDays());
  }

  async menu(clerkUserId: string, id: string) {
    const chef = await this.access.chef(clerkUserId);
    this.access.assertVerified(chef);
    const source = await this.access.readableMenu(chef, id);
    const copy = await this.prisma.menu.create({
      data: {
        chefProfileId: chef.id,
        createdByUserId: chef.userId,
        title: copyName(source.title, 160),
        pitch: source.pitch,
        period: source.period,
        shoppingIncluded: source.shoppingIncluded,
        status: MealStatus.draft,
        dishes: {
          create: source.dishes.map(({ mealId, position }) => ({ mealId, position })),
        },
      },
      include: MENU_DISHES,
    });
    const imageUrl = await this.copyPhoto('menu', chef.id, source.imageUrl, copy.id);
    const result = imageUrl
      ? await this.prisma.menu.update({
          where: { id: copy.id },
          data: { imageUrl },
          include: MENU_DISHES,
        })
      : copy;
    this.logger.log({ event: 'menu.duplicated', menuId: copy.id, copyOf: id });
    return toMenuView(result, await this.fridgeDays());
  }

  /**
   * The photo copied into the copy's own folder, or null: no photo, one stored
   * elsewhere, or a copy that failed (the copy simply goes without).
   */
  private async copyPhoto(
    kind: PhotoKind,
    chefId: string,
    url: string | null,
    copyId: string,
  ): Promise<string | null> {
    const key = this.storage.keyOf(url);
    if (!key) return null;
    const target = `${chefPhotoFolder(chefId, kind, copyId)}${key.split('/').pop()}`;
    return (await this.storage.copy(key, target)) ? this.storage.publicUrl(target) : null;
  }
}

/** Everything a cook needs, as a fresh draft: no status, verification or review carried over. */
function dishCopy(source: Meal, chef: ChefContext): Prisma.MealUncheckedCreateInput {
  return {
    chefProfileId: chef.id,
    createdByUserId: chef.userId,
    variantOfId: source.id,
    status: MealStatus.draft,
    // No version yet: the first one is made once the copy is "Prête".
    versionPending: true,
    name: copyName(source.name, 255),
    description: source.description,
    continent: source.continent,
    country: source.country,
    category: source.category,
    portions: source.portions,
    prepTime: source.prepTime,
    cookTime: source.cookTime,
    difficulty: source.difficulty,
    calories: source.calories,
    dietaryTags: source.dietaryTags,
    customDiets: source.customDiets,
    // Recettes §8.1: the computed allergens and the lines stamped with them, as they
    // are; the copy's own saves compose them again.
    allergens: source.allergens,
    allergensNone: source.allergensNone,
    addedAllergens: source.addedAllergens,
    conditionalAllergens: source.conditionalAllergens,
    customAllergens: source.customAllergens,
    ingredients: source.ingredients ?? [],
    steps: source.steps ?? [],
    equipment: source.equipment,
    reheating: source.reheating ?? Prisma.DbNull,
    storage: source.storage ?? Prisma.DbNull,
    declaredDiets: source.declaredDiets,
    profiles: source.profiles,
    personalTags: source.personalTags,
    seasonsOverride: source.seasonsOverride,
    classification: source.classification ?? Prisma.DbNull,
  };
}
