import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SentryCron } from '@sentry/nestjs';

import { stackOf } from '../../common/logging/app-logger';
import { DAY_MS } from '../../common/paris-time';
import { BookingStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CHEF_SEND_DAYS,
  dueReminders,
  REMINDER,
  ReminderKind,
} from '../shopping-lists/domain/shopping-reminders.rules';

/** Prestations that will take place: the only ones worth a reminder. */
const ACTIVE: BookingStatus[] = [BookingStatus.confirmed, BookingStatus.shopping];

/** One run reads at most this many prestations; the next hour takes the rest. */
const BATCH = 500;

/**
 * Recettes lot 4 (LF-0285): the in-app reminders of the shopping list, every hour.
 * Which reminder is due is a pure rule (`dueReminders`); this job claims it, then
 * tells the person. In the application only, never by e-mail.
 *
 * Safe on several replicas and across restarts: a reminder is claimed by an
 * `UPDATE` matching its still-empty timestamp, so two instances firing together
 * cannot both send it, and a reminder claimed is never sent again. A notification
 * that fails after the claim is lost, logged, and not retried: a reminder twice is
 * worse than a reminder missed.
 */
@Injectable()
export class ShoppingRemindersCron {
  private readonly logger = new Logger(ShoppingRemindersCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'shopping-list-reminders' })
  @SentryCron('shopping-list-reminders', {
    checkinMargin: 10,
    maxRuntime: 10,
    failureIssueThreshold: 2,
  })
  async run(now: Date = new Date()): Promise<Record<ReminderKind, number>> {
    const sent: Record<ReminderKind, number> = {
      chef_send: 0,
      client_answer: 0,
      client_frozen: 0,
      chef_groceries: 0,
    };
    const started = Date.now();
    try {
      const bookings = await this.prisma.booking.findMany({
        where: {
          status: { in: ACTIVE },
          shoppingByClient: false,
          // From the first reminder's window to the start of the prestation.
          startsAt: { gt: now, lte: new Date(now.getTime() + CHEF_SEND_DAYS * DAY_MS) },
          bookingMeals: { some: {} },
          OR: [
            { listReminderChefAt: null },
            { listReminderClientAt: null },
            { listFrozenNotifiedAt: null },
            { groceriesReminderAt: null },
          ],
        },
        select: {
          id: true,
          startsAt: true,
          clientId: true,
          groceriesValidatedAt: true,
          listReminderChefAt: true,
          listReminderClientAt: true,
          listFrozenNotifiedAt: true,
          groceriesReminderAt: true,
          chefProfile: { select: { userId: true } },
          shoppingList: {
            select: { version: true, sentAt: true, finalReceivedAt: true },
          },
        },
        orderBy: { startsAt: 'asc' },
        take: BATCH,
      });

      for (const booking of bookings) {
        const due = dueReminders(
          {
            ...booking,
            active: true,
            shoppingByClient: false,
            hasMeals: true,
            list: booking.shoppingList,
          },
          now,
        );
        for (const kind of due) {
          const { column, type, to } = REMINDER[kind];
          const claimed = await this.prisma.booking.updateMany({
            where: { id: booking.id, [column]: null },
            data: { [column]: now },
          });
          if (claimed.count !== 1) continue;
          const userId = to === 'client' ? booking.clientId : booking.chefProfile.userId;
          try {
            await this.notifications.notify(userId, type, {
              type: 'booking',
              id: booking.id,
            });
            sent[kind] += 1;
            this.logger.log({
              event: 'shopping_list.reminded',
              kind,
              bookingId: booking.id,
            });
          } catch (error) {
            this.logger.error(
              { event: 'shopping_list.reminder_failed', kind, bookingId: booking.id },
              stackOf(error),
            );
          }
        }
      }
      this.logger.log({
        event: 'job.shopping_list_reminders',
        read: bookings.length,
        ...sent,
        ms: Date.now() - started,
      });
      return sent;
    } catch (error) {
      this.logger.error({ event: 'job.shopping_list_reminders_failed' }, stackOf(error));
      throw error;
    }
  }
}
