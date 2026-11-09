import { Injectable, Logger } from '@nestjs/common';

import { stackOf } from '../../common/logging/app-logger';
import { BookingStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import {
  checkable,
  CLIENT_ALLERGY_SELECT,
  ClientAllergies,
  conflicts,
  CONSENT_WITHDRAWN,
  DISH_ALLERGEN_SELECT,
  newConflicts,
  toDeclaration,
} from './domain/allergies.rules';
import { DeclareAllergiesDto } from './dto/allergies.dto';

/** A prestation still to cook: its menu can still put the client at risk. */
const UPCOMING: BookingStatus[] = ['pending', 'confirmed', 'shopping', 'cooking'];

/**
 * The client's allergy declaration (Recettes lot 1). Logs carry counts and ids,
 * never an allergy.
 */
@Injectable()
export class AllergiesService {
  private readonly logger = new Logger(AllergiesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly notifications: NotificationsService,
  ) {}

  /** `PUT /me/profile/allergies`. Creates the client profile when there is none yet. */
  async declare(clerkUserId: string, dto: DeclareAllergiesDto) {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    await this.users.assertNoConflictingProfile(user.id, 'client');
    const data = toDeclaration(dto, new Date());
    const before = await this.prisma.clientProfile.findUnique({
      where: { userId: user.id },
      select: CLIENT_ALLERGY_SELECT,
    });
    const after = await this.prisma.clientProfile.upsert({
      where: { userId: user.id },
      update: data,
      create: { userId: user.id, ...data },
    });
    this.logger.log({
      event: 'client.allergies_declared',
      clientProfileId: after.id,
      none: after.allergiesNone,
      count: after.allergies.length + after.customAllergies.length,
    });
    await this.recheck(user.id, before, after);
    return this.users.getProfileByClerkUserId(clerkUserId);
  }

  /** `DELETE /me/profile/health-consent`: the allergies go with it, and the question comes back. */
  async withdraw(clerkUserId: string) {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    const { count } = await this.prisma.clientProfile.updateMany({
      where: { userId: user.id },
      data: CONSENT_WITHDRAWN,
    });
    this.logger.log({ event: 'client.health_consent_withdrawn', userId: user.id, count });
    return this.users.getProfileByClerkUserId(clerkUserId);
  }

  /**
   * R41: an allergy declared after a menu was validated. Each prestation still to
   * cook is checked again, and a dish newly in conflict is flagged to the client and
   * to the batch cooker. Best effort: the declaration stands whatever happens here,
   * and the booking shows its conflicts live anyway.
   */
  private async recheck(
    userId: string,
    before: ClientAllergies | null,
    after: ClientAllergies,
  ) {
    try {
      const bookings = await this.prisma.booking.findMany({
        where: {
          clientId: userId,
          status: { in: UPCOMING },
          endsAt: { gte: new Date() },
          bookingMeals: { some: {} },
        },
        select: {
          id: true,
          quote: { select: { allergies: true } },
          chefProfile: { select: { userId: true } },
          bookingMeals: { select: { meal: { select: DISH_ALLERGEN_SELECT } } },
        },
      });
      let flagged = 0;
      for (const booking of bookings) {
        const dishes = booking.bookingMeals.map((line) => line.meal);
        const extra = booking.quote?.allergies ?? [];
        const older = before ? conflicts(checkable(before, extra).codes, dishes) : [];
        const fresh = newConflicts(
          older,
          conflicts(checkable(after, extra).codes, dishes),
        );
        if (!fresh.length) continue;
        flagged += 1;
        const subject = { type: 'booking', id: booking.id };
        await this.notifications.notify(userId, 'allergy.conflict', subject);
        await this.notifications.notify(
          booking.chefProfile.userId,
          'mission.allergy_conflict',
          subject,
        );
      }
      this.logger.log({
        event: 'client.allergies_rechecked',
        userId,
        bookings: bookings.length,
        flagged,
      });
    } catch (error) {
      this.logger.error(
        { event: 'client.allergies_recheck_failed', userId },
        stackOf(error),
      );
    }
  }
}
