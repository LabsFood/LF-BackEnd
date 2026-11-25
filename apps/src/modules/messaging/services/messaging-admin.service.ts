import { Injectable, NotFoundException } from '@nestjs/common';

import { AuditService } from '../../../common/audit/audit.service';
import {
  Paginated,
  buildPaginationMeta,
  resolvePageBounds,
} from '../../../common/dto/pagination.dto';
import { Prisma, User, UserRole } from '../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { UsersService } from '../../users/users.service';
import { PairBooking, currentBooking } from '../domain/messaging.rules';
import {
  AdminListConversationsQueryDto,
  CreateAttachmentUploadDto,
  ListMessagesQueryDto,
  SendMessageDto,
} from '../dto/messaging.dto';
import type {
  AdminConversationView,
  AdminMessageView,
  AdminPartyView,
  MessagePage,
  SenderRole,
} from '../messaging.types';
import { MessagingEventsService } from './messaging-events.service';
import { MessagingStorageService } from './messaging-storage.service';
import {
  CONVERSATION_INCLUDE,
  LoadedConversation,
  MessagingService,
  toAdminMessageView,
  toBookingSummary,
} from './messaging.service';

/**
 * The back office: the support inbox, and every client ↔ batch cooker thread for
 * moderation.
 *
 * Admins hold no participant row: they read any thread and write as "the team".
 * Reading or writing in a thread that is not theirs to begin with, a client's
 * with a cook, is recorded in the audit log.
 */
@Injectable()
export class MessagingAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly messaging: MessagingService,
    private readonly storage: MessagingStorageService,
    private readonly events: MessagingEventsService,
    private readonly audit: AuditService,
  ) {}

  async list(
    query: AdminListConversationsQueryDto,
  ): Promise<Paginated<AdminConversationView>> {
    const bounds = resolvePageBounds(query);
    const where: Prisma.ConversationWhereInput = {
      // A thread nobody has written in yet is of no use to the team.
      lastMessageAt: { not: null },
      ...(query.type ? { type: query.type } : {}),
      ...(query.filter === 'unread' ? { adminUnreadCount: { gt: 0 } } : {}),
      ...(query.filter === 'flagged' ? { contactFlaggedAt: { not: null } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        include: CONVERSATION_INCLUDE,
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        skip: bounds.skip,
        take: bounds.take,
      }),
      this.prisma.conversation.count({ where }),
    ]);
    const bookings = await this.messaging.pairBookings(rows);
    const now = new Date();
    return {
      data: rows.map((c) => toAdminView(c, bookings.get(c.id) ?? [], now)),
      meta: buildPaginationMeta(bounds, total),
    };
  }

  /** The two numbers behind the sidebar badge. */
  async counts(): Promise<{ unread: number; flagged: number }> {
    const [unread, flagged] = await Promise.all([
      this.prisma.conversation.aggregate({ _sum: { adminUnreadCount: true } }),
      this.prisma.conversation.count({ where: { contactFlaggedAt: { not: null } } }),
    ]);
    return { unread: unread._sum.adminUnreadCount ?? 0, flagged };
  }

  async get(id: string): Promise<AdminConversationView> {
    const conversation = await this.messaging.loadConversation(id);
    const bookings = await this.messaging.bookingsOf(conversation);
    return toAdminView(conversation, bookings, new Date());
  }

  async listMessages(
    clerkUserId: string,
    id: string,
    query: ListMessagesQueryDto,
    requestId?: string,
  ): Promise<MessagePage<AdminMessageView>> {
    const conversation = await this.messaging.loadConversation(id);
    const page = await this.messaging.pageMessages(id, query);
    // Once per opening, not once per page scrolled.
    if (conversation.type === 'chef_client' && !query.before) {
      const admin = await this.admin(clerkUserId);
      await this.audit.record({
        actorType: 'admin',
        actorUserId: admin.id,
        action: 'conversation.read',
        subjectType: 'conversation',
        subjectId: id,
        requestId,
      });
    }
    return { data: page.data.map(toAdminMessageView), nextCursor: page.nextCursor };
  }

  async sendMessage(
    clerkUserId: string,
    id: string,
    dto: SendMessageDto,
    requestId?: string,
  ): Promise<AdminMessageView> {
    const admin = await this.admin(clerkUserId);
    const conversation = await this.messaging.loadConversation(id);
    const { message } = await this.messaging.postMessage(
      conversation,
      { userId: admin.id, role: 'support', isAdmin: true },
      dto,
    );
    if (conversation.type === 'support') {
      // Answering is having read: the thread leaves the unread inbox.
      await this.clearUnread(conversation);
    } else {
      await this.audit.record({
        actorType: 'admin',
        actorUserId: admin.id,
        action: 'conversation.intervened',
        subjectType: 'conversation',
        subjectId: id,
        metadata: { messageId: message.id },
        requestId,
      });
    }
    return toAdminMessageView(message);
  }

  async markRead(id: string): Promise<void> {
    await this.clearUnread(await this.messaging.loadConversation(id));
  }

  /** "Seen, nothing to do": takes the thread out of the flagged queue. */
  async dismissFlag(clerkUserId: string, id: string, requestId?: string): Promise<void> {
    const conversation = await this.messaging.loadConversation(id);
    if (!conversation.contactFlaggedAt) return;
    const admin = await this.admin(clerkUserId);
    await this.prisma.conversation.update({
      where: { id },
      data: { contactFlaggedAt: null },
    });
    await this.audit.record({
      actorType: 'admin',
      actorUserId: admin.id,
      action: 'conversation.flag_dismissed',
      subjectType: 'conversation',
      subjectId: id,
      metadata: { flaggedAt: conversation.contactFlaggedAt.toISOString() },
      requestId,
    });
    this.notifyAdmins(id);
  }

  /** The team writes first: opens (or finds) someone's support thread. */
  async openSupport(userId: string): Promise<AdminConversationView> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, deletedAt: true },
    });
    if (!user || user.deletedAt || user.role === UserRole.admin) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'No client or batch cooker with this id.',
      });
    }
    return this.get(await this.messaging.ensureSupport(user));
  }

  async createUploadUrl(clerkUserId: string, id: string, dto: CreateAttachmentUploadDto) {
    const admin = await this.admin(clerkUserId);
    await this.messaging.loadConversation(id);
    return this.storage.createUploadUrl(id, admin.id, dto.mimeType, dto.sizeBytes);
  }

  async attachmentDownloadUrl(id: string, attachmentId: string) {
    return this.messaging.downloadUrl(id, attachmentId);
  }

  private async clearUnread(conversation: LoadedConversation): Promise<void> {
    if (conversation.adminUnreadCount === 0) return;
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { adminUnreadCount: 0 },
    });
    this.notifyAdmins(conversation.id);
  }

  /** The other admins' inbox and badge follow what one of them just did. */
  private notifyAdmins(conversationId: string): void {
    void this.events.publish({
      userIds: [],
      toUsers: null,
      toAdmins: { event: 'conversation.updated', data: { conversationId } },
    });
  }

  private async admin(clerkUserId: string): Promise<User> {
    return (
      (await this.users.findByClerkId(clerkUserId)) ??
      this.users.ensurePersistedFromClerk(clerkUserId)
    );
  }
}

type Person = NonNullable<LoadedConversation['client']>;

const party = (person: Person, name?: string): AdminPartyView => ({
  userId: person.id,
  name: name ?? person.fullName ?? person.email,
  email: person.deletedAt ? null : person.email,
  avatarUrl: person.avatarUrl,
});

function toAdminView(
  conversation: LoadedConversation,
  bookings: PairBooking[],
  now: Date,
): AdminConversationView {
  const { client, chefProfile, supportUser } = conversation;
  const last = conversation.messages[0];
  const supportRole: SenderRole = supportUser?.role === UserRole.chef ? 'chef' : 'client';
  return {
    id: conversation.id,
    type: conversation.type,
    client: client ? party(client) : null,
    chef: chefProfile
      ? {
          ...party(chefProfile.user, chefProfile.displayName),
          chefProfileId: chefProfile.id,
        }
      : null,
    supportUser: supportUser ? { ...party(supportUser), role: supportRole } : null,
    booking: toBookingSummary(currentBooking(bookings, now)),
    contactReleased: false,
    contactFlaggedAt: conversation.contactFlaggedAt,
    lastMessage: last ? toAdminMessageView(last) : null,
    lastMessageAt: conversation.lastMessageAt,
    unreadCount: conversation.adminUnreadCount,
    createdAt: conversation.createdAt,
  };
}
