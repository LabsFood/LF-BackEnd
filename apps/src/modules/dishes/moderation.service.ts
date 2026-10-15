import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { Meal, MealStatus, Menu, Prisma } from '../../generated/prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { buildPaginationMeta, resolvePageBounds } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { DishesMailer } from './dishes.mailer';
import { toDishView } from './dishes.views';
import {
  CLEARED_MODERATION,
  isValidReason,
  REASON_LENGTH,
  recurringValues,
  reviewFlags,
} from './domain/moderation.rules';
import { ContentQueryDto, ModerationDto, ReviewDto } from './dto/moderation.dto';
import { toMenuView } from './menus.service';
import { R2StorageService } from '../../integrations/r2-storage.service';
import { chefPhotoFolder } from './content-photos.service';

/** Removal reasons where the photo itself may be what is wrong. */
const PHOTO_REASONS = new Set(['inappropriate-content', 'copyright']);

type Kind = 'dish' | 'menu';

/** Moderation concerns batch cookers' content only; Lab's Food's is its own. */
const CHEF_CONTENT = { chefProfileId: { not: null } };

const WITH_CHEF = { chefProfile: { select: { id: true, displayName: true } } };

/** Around a dish, for admins (§4.4): who wrote it, and how much it is used. */
const ADMIN_DISH = {
  chefProfile: { select: { id: true, displayName: true } },
  _count: { select: { menus: true, bookingMeals: true } },
} satisfies Prisma.MealInclude;

const ADMIN_MENU = {
  chefProfile: ADMIN_DISH.chefProfile,
  dishes: { orderBy: { position: 'asc' }, include: { meal: { include: ADMIN_DISH } } },
} satisfies Prisma.MenuInclude;

type AdminMeal = Prisma.MealGetPayload<{ include: typeof ADMIN_DISH }>;
type AdminMenu = Prisma.MenuGetPayload<{ include: typeof ADMIN_MENU }>;

/** Nobody needs to look any more. */
const REVIEWED = (now: Date) => ({
  reviewedAt: now,
  reviewPendingSince: null,
  reviewReason: null,
});

/**
 * Moderation after the fact (FLOW-02 §4). Publication is direct, so this queue is
 * the only control there is: content waits here until an admin marks it reviewed,
 * or takes it down with a reason the chef reads as written.
 */
@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mailer: DishesMailer,
    private readonly storage: R2StorageService,
  ) {}

  /**
   * §4.1. With `review=pending`: dishes and menus waiting, a republication after
   * suspension first, then the longest wait. Otherwise: batch cookers' dishes,
   * most recently changed first.
   *
   * ponytail: merges both tables and pages in memory. The queue is what admins
   * have not looked at yet, so it stays short; page in SQL if it ever does not.
   */
  async list(query: ContentQueryDto) {
    const pending = query.review === 'pending';
    const where = {
      chefProfileId: query.chefId ?? { not: null },
      ...(pending && { reviewPendingSince: { not: null }, status: MealStatus.published }),
    };
    const wantDishes = query.type !== 'menu';
    const wantMenus = pending ? query.type !== 'dish' : query.type === 'menu';
    const [dishes, menus] = await Promise.all([
      wantDishes ? this.prisma.meal.findMany({ where, include: WITH_CHEF }) : [],
      wantMenus ? this.prisma.menu.findMany({ where, include: WITH_CHEF }) : [],
    ]);

    const items = [
      ...dishes.map((dish) => toQueueItem('dish', dish)),
      ...menus.map((menu) => toQueueItem('menu', menu)),
    ].sort(
      pending
        ? (a, b) =>
            Number(b.reviewState === 'republished-after-suspension') -
              Number(a.reviewState === 'republished-after-suspension') ||
            a.pendingSince!.getTime() - b.pendingSince!.getTime()
        : (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
    );

    const bounds = resolvePageBounds(query);
    return {
      data: items.slice(bounds.skip, bounds.skip + bounds.take).map(stripUpdatedAt),
      meta: buildPaginationMeta(bounds, items.length),
    };
  }

  /** §4.2: out of the queue, nothing changes for the chef. One click. */
  async review(kind: Kind, id: string, adminUserId: string, payload: ReviewDto) {
    const now = new Date();
    const where = { id, ...CHEF_CONTENT };
    const { count } =
      kind === 'dish'
        ? await this.prisma.meal.updateMany({ where, data: REVIEWED(now) })
        : await this.prisma.menu.updateMany({ where, data: REVIEWED(now) });
    if (count === 0) throw new NotFoundException('No batch cooker content with this id.');

    await this.audit.record({
      actorType: 'admin',
      actorUserId: adminUserId,
      action: 'content.reviewed',
      subjectType: kind === 'dish' ? 'meal' : 'menu',
      subjectId: id,
      metadata: { outcome: payload.outcome, note: payload.note ?? null },
    });
    return { type: kind, id, reviewedAt: now };
  }

  /**
   * §4.3. Suspending takes the content off the public site at once (and a dish
   * out of every menu showing it), emails the chef and is audited. Bookings
   * already made are not touched. Lifting a suspension needs a reason too.
   */
  async moderate(kind: Kind, id: string, adminUserId: string, payload: ModerationDto) {
    if (!isValidReason(payload.reason)) {
      throw new UnprocessableEntityException({
        code: 'REASON_REQUIRED',
        message: `Give a reason of ${REASON_LENGTH.min} to ${REASON_LENGTH.max} characters: the batch cooker reads it as written.`,
      });
    }
    const reason = payload.reason.trim();
    const current = await this.find(kind, id);
    const now = new Date();

    if (payload.status === 'suspended') {
      const reasonCode = payload.reasonCode ?? 'other';
      // When the picture may be the problem, it comes off the content and leaves
      // the public bucket too: suspending only the row would leave it at its
      // public address. Only the chef's own file goes; a copy of a Lab's Food
      // suggestion shares the suggestion's, which stays.
      const pictured = PHOTO_REASONS.has(reasonCode) && current.imageUrl !== null;
      const photo =
        pictured && current.chefProfileId
          ? this.storage.ownedKey(
              current.imageUrl,
              chefPhotoFolder(current.chefProfileId, kind, id),
            )
          : null;
      await this.transition(kind, id, MealStatus.published, {
        status: MealStatus.suspended,
        moderationReason: reason,
        moderationReasonCode: reasonCode,
        moderatedAt: now,
        ...REVIEWED(now),
        ...(pictured && { imageUrl: null }),
      });
      if (photo) await this.storage.delete(photo);
      await this.audit.record({
        actorType: 'admin',
        actorUserId: adminUserId,
        action: 'content.suspended',
        subjectType: kind === 'dish' ? 'meal' : 'menu',
        subjectId: id,
        metadata: { reason, reasonCode },
      });
      if (payload.notifyChef !== false)
        await this.notifySuspension(kind, current, reason, reasonCode);
    } else {
      await this.transition(kind, id, MealStatus.suspended, {
        status: MealStatus.published,
        ...CLEARED_MODERATION,
        ...REVIEWED(now),
      });
      await this.audit.record({
        actorType: 'admin',
        actorUserId: adminUserId,
        action: 'content.reinstated',
        subjectType: kind === 'dish' ? 'meal' : 'menu',
        subjectId: id,
        metadata: { reason },
      });
    }
    return kind === 'dish' ? this.adminDish(id) : this.adminMenu(id);
  }

  /** §4.4: everything a batch cooker wrote, recipes included, as admins may see it. */
  async chefDishes(chefProfileId: string) {
    await this.assertChef(chefProfileId);
    const dishes = await this.prisma.meal.findMany({
      where: { chefProfileId },
      include: ADMIN_DISH,
      orderBy: { updatedAt: 'desc' },
    });
    return dishes.map(toAdminDishView);
  }

  async chefMenus(chefProfileId: string) {
    await this.assertChef(chefProfileId);
    const menus = await this.prisma.menu.findMany({
      where: { chefProfileId },
      include: ADMIN_MENU,
      orderBy: { updatedAt: 'desc' },
    });
    return menus.map(toAdminMenuReviewView);
  }

  /** §3.1: free-text values chefs keep typing, the candidates for the lists. */
  async customValues() {
    const rows = await this.prisma.meal.findMany({
      where: {
        ...CHEF_CONTENT,
        OR: [
          { customDiets: { isEmpty: false } },
          { customAllergens: { isEmpty: false } },
        ],
      },
      select: { customDiets: true, customAllergens: true },
    });
    return {
      diets: recurringValues(rows.flatMap((row) => row.customDiets)),
      allergens: recurringValues(rows.flatMap((row) => row.customAllergens)),
    };
  }

  private async find(kind: Kind, id: string) {
    const include = {
      chefProfile: {
        select: { id: true, user: { select: { email: true, fullName: true } } },
      },
    };
    const row =
      kind === 'dish'
        ? await this.prisma.meal.findFirst({ where: { id, ...CHEF_CONTENT }, include })
        : await this.prisma.menu.findFirst({ where: { id, ...CHEF_CONTENT }, include });
    if (!row) throw new NotFoundException('No batch cooker content with this id.');
    return row;
  }

  /** Moves `from` → the new status in one statement, or says why it cannot. */
  private async transition(
    kind: Kind,
    id: string,
    from: MealStatus,
    data: Record<string, unknown>,
  ) {
    const where = { id, status: from, ...CHEF_CONTENT };
    const { count } =
      kind === 'dish'
        ? await this.prisma.meal.updateMany({ where, data })
        : await this.prisma.menu.updateMany({ where, data });
    if (count === 0) {
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        message:
          from === MealStatus.published
            ? 'Only published content can be taken down.'
            : 'Only suspended content can be reinstated.',
      });
    }
  }

  /** The chef hears why, and which of their published menus the dish leaves. */
  private async notifySuspension(
    kind: Kind,
    content: (Meal | Menu) & {
      chefProfile: {
        id: string;
        user: { email: string; fullName: string | null };
      } | null;
    },
    reason: string,
    reasonCode: string,
  ) {
    if (!content.chefProfile) return;
    const menus =
      kind === 'dish'
        ? await this.prisma.menu.findMany({
            where: {
              chefProfileId: content.chefProfile.id,
              status: MealStatus.published,
              dishes: { some: { mealId: content.id } },
            },
            select: { title: true },
          })
        : [];
    await this.mailer.contentSuspended({
      email: content.chefProfile.user.email,
      name: content.chefProfile.user.fullName,
      kind,
      title: 'name' in content ? content.name : content.title,
      reason,
      reasonCode,
      menus: menus.map((menu) => menu.title),
    });
  }

  private async assertChef(chefProfileId: string) {
    const chef = await this.prisma.chefProfile.findUnique({
      where: { id: chefProfileId },
      select: { id: true },
    });
    if (!chef) throw new NotFoundException('No batch cooker with this id.');
  }

  private async adminDish(id: string) {
    return toAdminDishView(
      await this.prisma.meal.findUniqueOrThrow({ where: { id }, include: ADMIN_DISH }),
    );
  }

  private async adminMenu(id: string) {
    return toAdminMenuReviewView(
      await this.prisma.menu.findUniqueOrThrow({ where: { id }, include: ADMIN_MENU }),
    );
  }
}

/** Where the content stands with the admins. */
const reviewOf = (row: Meal | Menu) => ({
  reviewedAt: row.reviewedAt,
  pendingSince: row.reviewPendingSince,
  reason: row.reviewReason,
});

const toAdminDishView = ({ chefProfile, _count, ...meal }: AdminMeal) => ({
  ...toDishView(meal),
  chefProfileId: meal.chefProfileId,
  chef: chefProfile,
  /** Menus it is on, and bookings that served it: what removing it would touch. */
  usage: { menus: _count.menus, bookings: _count.bookingMeals },
  review: reviewOf(meal),
});

const toAdminMenuReviewView = ({ chefProfile, ...menu }: AdminMenu) => ({
  ...toMenuView(menu),
  chefProfileId: menu.chefProfileId,
  chef: chefProfile,
  dishCount: menu.dishes.length,
  // Each dish as `GET /admin/chefs/{id}/dishes` shows it.
  dishes: menu.dishes.map(({ meal }) => toAdminDishView(meal)),
  review: reviewOf(menu),
});

/** One line of §4.1's queue. */
function toQueueItem(
  type: Kind,
  row: (Meal | Menu) & { chefProfile: { id: string; displayName: string } | null },
) {
  const dish = type === 'dish' ? (row as Meal) : null;
  return {
    type,
    id: row.id,
    name: dish ? dish.name : (row as Menu).title,
    chef: row.chefProfile,
    status: row.status,
    publishedAt: row.publishedAt,
    reviewState: row.reviewReason,
    pendingSince: row.reviewPendingSince,
    reviewedAt: row.reviewedAt,
    flags: reviewFlags({
      reviewReason: row.reviewReason,
      customAllergens: dish?.customAllergens,
      customDiets: dish?.customDiets,
      allergensNone: dish?.allergensNone,
    }),
    customAllergens: dish?.customAllergens ?? [],
    customDiets: dish?.customDiets ?? [],
    updatedAt: row.updatedAt,
  };
}

const stripUpdatedAt = <T extends { updatedAt: Date }>({ updatedAt: _u, ...rest }: T) =>
  rest;
