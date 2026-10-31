import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import {
  PaginationQueryDto,
  buildPaginationMeta,
  resolvePageBounds,
} from '../../common/dto/pagination.dto';
import { Notification } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';

/**
 * The in-app bell (Recettes §12). A notification is a type and the thing it is
 * about: the fronts word it, and fetch the subject for details. Nothing here ever
 * carries an allergy or personal data, and no e-mail is sent.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  /** For the Recettes lots that alert someone (allergy conflict, shopping list…). */
  async notify(userId: string, type: string, subject: { type: string; id: string }) {
    const notification = await this.prisma.notification.create({
      data: { userId, type, subjectType: subject.type, subjectId: subject.id },
    });
    this.logger.log({
      event: 'notification.created',
      notificationId: notification.id,
      type,
      subjectType: subject.type,
      subjectId: subject.id,
    });
    return toView(notification);
  }

  async listMine(clerkUserId: string, query: PaginationQueryDto) {
    const userId = await this.userId(clerkUserId);
    const bounds = resolvePageBounds(query);
    const [rows, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: bounds.skip,
        take: bounds.take,
      }),
      this.prisma.notification.count({ where: { userId } }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return {
      data: rows.map(toView),
      meta: buildPaginationMeta(bounds, total),
      unreadCount,
    };
  }

  /** Someone else's notification is reported missing, never revealed. */
  async markRead(clerkUserId: string, id: string) {
    const userId = await this.userId(clerkUserId);
    const notification = await this.prisma.notification.findFirst({
      where: { id, userId },
    });
    if (!notification) {
      throw new NotFoundException({
        code: 'NOTIFICATION_NOT_FOUND',
        message: 'No such notification.',
      });
    }
    if (notification.readAt) return toView(notification);

    return toView(
      await this.prisma.notification.update({
        where: { id },
        data: { readAt: new Date() },
      }),
    );
  }

  private async userId(clerkUserId: string): Promise<string> {
    const user =
      (await this.users.findByClerkId(clerkUserId)) ??
      (await this.users.ensurePersistedFromClerk(clerkUserId));
    return user.id;
  }
}

function toView(notification: Notification) {
  return {
    id: notification.id,
    type: notification.type,
    subjectType: notification.subjectType,
    subjectId: notification.subjectId,
    readAt: notification.readAt,
    createdAt: notification.createdAt,
  };
}
