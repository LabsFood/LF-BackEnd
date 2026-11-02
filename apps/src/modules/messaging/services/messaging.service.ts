import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { Prisma, User, UserRole } from '../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { allergyLabels } from '../../allergies/domain/allergies.rules';
import { UsersService } from '../../users/users.service';
import { detectContact, maskContact } from '../domain/contact-detector';
import {
  DEFAULT_MESSAGE_PAGE_SIZE,
  MAX_MESSAGE_PAGE_SIZE,
  PairBooking,
  currentBooking,
  isContactReleased,
  isWritable,
  nextContactReleaseAt,
  shortName,
} from '../domain/messaging.rules';
import {
  CreateAttachmentUploadDto,
  ListMessagesQueryDto,
  SendMessageDto,
} from '../dto/messaging.dto';
import type {
  AdminMessageView,
  AttachmentView,
  BookingSummary,
  ClientCardView,
  ConversationDetailView,
  ConversationView,
  CounterpartView,
  MessagePage,
  MessageView,
  SenderRole,
} from '../messaging.types';
import { MessagingEventsService } from './messaging-events.service';
import { MessagingRateLimiter } from './messaging-rate-limiter';
import { MessagingStorageService } from './messaging-storage.service';

export const SUPPORT_NAME = 'Support Lab’s Food';

const PERSON = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  avatarUrl: true,
  role: true,
  deletedAt: true,
} satisfies Prisma.UserSelect;

const MESSAGE_INCLUDE = {
  attachments: true,
  sender: { select: { fullName: true } },
} satisfies Prisma.MessageInclude;

/** Newest first, with the id as a tie-break so a page boundary is never ambiguous. */
const NEWEST_FIRST = [
  { createdAt: 'desc' },
  { id: 'desc' },
] satisfies Prisma.MessageOrderByWithRelationInput[];

export const CONVERSATION_INCLUDE = {
  client: { select: PERSON },
  chefProfile: { select: { id: true, displayName: true, user: { select: PERSON } } },
  supportUser: { select: PERSON },
  messages: { orderBy: NEWEST_FIRST, take: 1, include: MESSAGE_INCLUDE },
} satisfies Prisma.ConversationInclude;

export type LoadedConversation = Prisma.ConversationGetPayload<{
  include: typeof CONVERSATION_INCLUDE;
}>;
export type LoadedMessage = Prisma.MessageGetPayload<{ include: typeof MESSAGE_INCLUDE }>;

type Membership = { role: SenderRole; unreadCount: number };

/** Who is posting. An admin writes as the team, whatever the thread. */
export interface Sender {
  userId: string;
  role: SenderRole;
  isAdmin: boolean;
}

const notFound = () =>
  new NotFoundException({
    code: 'CONVERSATION_NOT_FOUND',
    message: 'Conversation not found.',
  });

/**
 * Conversations as their participants use them, and the one place a message is
 * posted from (`postMessage`), whoever posts it.
 *
 * One access rule: a conversation the caller does not take part in answers 404,
 * on a read as on a write, so its existence is never confirmed to a stranger.
 */
@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly storage: MessagingStorageService,
    private readonly rateLimiter: MessagingRateLimiter,
    private readonly events: MessagingEventsService,
  ) {}

  // ── Participant routes ────────────────────────────────────────────────────

  async listMine(clerkUserId: string): Promise<ConversationView[]> {
    const user = await this.me(clerkUserId);
    const memberships = await this.prisma.conversationParticipant.findMany({
      where: { userId: user.id },
      include: { conversation: { include: CONVERSATION_INCLUDE } },
      orderBy: [
        { conversation: { lastMessageAt: { sort: 'desc', nulls: 'last' } } },
        { createdAt: 'desc' },
      ],
    });
    const bookings = await this.pairBookings(memberships.map((m) => m.conversation));
    const now = new Date();
    return memberships.map((m) =>
      this.toView(m.conversation, m, bookings.get(m.conversationId) ?? [], now),
    );
  }

  async unreadCount(clerkUserId: string): Promise<{ total: number }> {
    const user = await this.me(clerkUserId);
    const sum = await this.prisma.conversationParticipant.aggregate({
      where: { userId: user.id },
      _sum: { unreadCount: true },
    });
    return { total: sum._sum.unreadCount ?? 0 };
  }

  /**
   * The thread between the client and the batch cooker of one of the caller's
   * bookings, created on first use.
   */
  async openForBooking(
    clerkUserId: string,
    bookingId: string,
  ): Promise<ConversationDetailView> {
    const user = await this.me(clerkUserId);
    const booking = await this.prisma.booking.findFirst({
      where: {
        id: bookingId,
        OR: [{ clientId: user.id }, { chefProfile: { userId: user.id } }],
      },
      select: { clientId: true, chefProfileId: true, status: true },
    });
    if (!booking) {
      throw new NotFoundException({
        code: 'BOOKING_NOT_FOUND',
        message: 'Booking not found.',
      });
    }
    if (booking.status === 'cancelled') {
      throw new ConflictException({
        code: 'BOOKING_CANCELLED',
        message: 'A cancelled booking does not open a conversation.',
      });
    }
    const id = await this.ensurePair(booking.clientId, booking.chefProfileId);
    return this.detailFor(user.id, id);
  }

  /** The caller's thread with the Lab's Food team, created on first use. */
  async openSupport(clerkUserId: string): Promise<ConversationDetailView> {
    const user = await this.me(clerkUserId);
    if (user.role === UserRole.admin) {
      throw new ForbiddenException({
        code: 'ADMIN_USES_BACK_OFFICE',
        message: 'Admins answer support threads from /admin/conversations.',
      });
    }
    const id = await this.ensureSupport(user);
    return this.detailFor(user.id, id);
  }

  async getMine(clerkUserId: string, id: string): Promise<ConversationDetailView> {
    const user = await this.me(clerkUserId);
    return this.detailFor(user.id, id);
  }

  async listMessages(
    clerkUserId: string,
    id: string,
    query: ListMessagesQueryDto,
  ): Promise<MessagePage<MessageView>> {
    const user = await this.me(clerkUserId);
    const { conversation } = await this.loadForParticipant(user.id, id);
    const masked = await this.isMasked(conversation);
    const page = await this.pageMessages(id, query);
    return {
      data: page.data.map((m) => toMessageView(m, masked)),
      nextCursor: page.nextCursor,
    };
  }

  async sendMessage(
    clerkUserId: string,
    id: string,
    dto: SendMessageDto,
  ): Promise<MessageView> {
    const user = await this.me(clerkUserId);
    // Before anything is read: a flood is refused without touching the database.
    await this.rateLimiter.assertCanSend(user.id);
    const { conversation, membership } = await this.loadForParticipant(user.id, id);
    const { message, masked } = await this.postMessage(
      conversation,
      { userId: user.id, role: membership.role, isAdmin: false },
      dto,
    );
    return toMessageView(message, masked);
  }

  async markRead(clerkUserId: string, id: string): Promise<void> {
    const user = await this.me(clerkUserId);
    const { membership } = await this.loadForParticipant(user.id, id);
    await this.prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId: id, userId: user.id } },
      data: { unreadCount: 0, lastReadAt: new Date() },
    });
    if (membership.unreadCount > 0) {
      // The same person on another tab or device: its badge follows.
      void this.events.publish({
        userIds: [user.id],
        toUsers: { event: 'conversation.updated', data: { conversationId: id } },
        toAdmins: null,
      });
    }
  }

  async createUploadUrl(clerkUserId: string, id: string, dto: CreateAttachmentUploadDto) {
    const user = await this.me(clerkUserId);
    const { conversation } = await this.loadForParticipant(user.id, id);
    await this.assertWritable(conversation);
    return this.storage.createUploadUrl(id, user.id, dto.mimeType, dto.sizeBytes);
  }

  async attachmentDownloadUrl(clerkUserId: string, id: string, attachmentId: string) {
    const user = await this.me(clerkUserId);
    await this.loadForParticipant(user.id, id);
    return this.downloadUrl(id, attachmentId);
  }

  // ── Shared with the admin service ─────────────────────────────────────────

  /**
   * Posts one message. The only writer of `messages`, for participants and admins
   * alike, in this order: the thread is open, the message is not a retry, it has
   * content, its files really exist, contact details are detected, everything is
   * stored in one transaction, and only then is anyone told.
   */
  async postMessage(
    conversation: LoadedConversation,
    sender: Sender,
    dto: SendMessageDto,
  ): Promise<{ message: LoadedMessage; masked: boolean }> {
    const bookings = await this.bookingsOf(conversation);
    const now = new Date();
    const masked =
      conversation.type === 'chef_client' && !isContactReleased(bookings, now);

    if (dto.clientMessageId) {
      const existing = await this.findByClientMessageId(
        conversation.id,
        sender.userId,
        dto.clientMessageId,
      );
      if (existing) return { message: existing, masked };
    }

    if (!sender.isAdmin) this.assertOpen(conversation, bookings, now);

    const body = (dto.body ?? '').trim();
    const refs = dto.attachments ?? [];
    if (!body && refs.length === 0) {
      throw new UnprocessableEntityException({
        code: 'EMPTY_MESSAGE',
        message: 'A message needs a text or a file.',
      });
    }

    const attachments = await Promise.all(
      refs.map(async (ref) => {
        const storagePath = this.storage.pathFor(
          conversation.id,
          sender.userId,
          ref.uploadId,
        );
        const stat = await this.storage.statObject(storagePath);
        return { storagePath, fileName: ref.fileName, ...stat };
      }),
    );

    // The team is not policed, and a support thread hides nothing.
    const contactDetected =
      !sender.isAdmin && conversation.type === 'chef_client' && detectContact(body);
    const toTeam = conversation.type === 'support' && !sender.isAdmin;

    let message: LoadedMessage;
    try {
      message = await this.prisma.$transaction(async (tx) => {
        const created = await tx.message.create({
          data: {
            conversationId: conversation.id,
            senderUserId: sender.userId,
            senderRole: sender.role,
            body,
            contactDetected,
            clientMessageId: dto.clientMessageId ?? null,
            createdAt: now,
            attachments: {
              create: attachments.map((a) => ({
                conversationId: conversation.id,
                uploaderUserId: sender.userId,
                ...a,
              })),
            },
          },
          include: MESSAGE_INCLUDE,
        });
        await tx.conversation.update({
          where: { id: conversation.id },
          data: {
            lastMessageAt: now,
            ...(contactDetected ? { contactFlaggedAt: now } : {}),
            ...(toTeam ? { adminUnreadCount: { increment: 1 } } : {}),
          },
        });
        await tx.conversationParticipant.updateMany({
          where: { conversationId: conversation.id, userId: { not: sender.userId } },
          data: { unreadCount: { increment: 1 } },
        });
        // Writing in a thread is having read it.
        await tx.conversationParticipant.updateMany({
          where: { conversationId: conversation.id, userId: sender.userId },
          data: { unreadCount: 0, lastReadAt: now },
        });
        return created;
      });
    } catch (error) {
      // Two identical sends raced: the unique index let one through. Serve it.
      const winner =
        dto.clientMessageId && isUniqueViolation(error)
          ? await this.findByClientMessageId(
              conversation.id,
              sender.userId,
              dto.clientMessageId,
            )
          : null;
      if (!winner) throw error;
      return { message: winner, masked };
    }

    void this.events.publish({
      userIds: participantIds(conversation),
      toUsers: {
        event: 'message.created',
        data: {
          conversationId: conversation.id,
          message: toMessageView(message, masked),
        },
      },
      toAdmins: {
        event: 'message.created',
        data: { conversationId: conversation.id, message: toAdminMessageView(message) },
      },
    });

    return { message, masked };
  }

  async loadConversation(id: string): Promise<LoadedConversation> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
      include: CONVERSATION_INCLUDE,
    });
    if (!conversation) throw notFound();
    return conversation;
  }

  /** One page of a thread, oldest first, from the newest or from above a cursor. */
  async pageMessages(
    conversationId: string,
    query: ListMessagesQueryDto,
  ): Promise<MessagePage<LoadedMessage>> {
    const limit = Math.min(
      MAX_MESSAGE_PAGE_SIZE,
      Math.max(1, query.limit ?? DEFAULT_MESSAGE_PAGE_SIZE),
    );
    if (query.before) {
      // A cursor from another thread would otherwise page from the wrong place.
      const anchor = await this.prisma.message.findFirst({
        where: { id: query.before, conversationId },
        select: { id: true },
      });
      if (!anchor) {
        throw new UnprocessableEntityException({
          code: 'INVALID_CURSOR',
          message: '`before` is not a message of this conversation.',
        });
      }
    }
    const rows = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: NEWEST_FIRST,
      take: limit + 1,
      ...(query.before ? { cursor: { id: query.before }, skip: 1 } : {}),
      include: MESSAGE_INCLUDE,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const oldest = page[page.length - 1];
    return {
      data: [...page].reverse(),
      nextCursor: hasMore ? oldest.id : null,
    };
  }

  /** The bookings between the two people of each `chef_client` conversation. */
  async pairBookings(
    conversations: Pick<LoadedConversation, 'id' | 'clientId' | 'chefProfileId'>[],
  ): Promise<Map<string, PairBooking[]>> {
    const pairs = conversations.filter((c) => c.clientId && c.chefProfileId);
    const byConversation = new Map<string, PairBooking[]>();
    if (pairs.length === 0) return byConversation;

    const rows = await this.prisma.booking.findMany({
      where: {
        status: { not: 'cancelled' },
        OR: pairs.map((c) => ({
          clientId: c.clientId as string,
          chefProfileId: c.chefProfileId as string,
        })),
      },
      select: {
        id: true,
        reference: true,
        status: true,
        startsAt: true,
        endsAt: true,
        clientId: true,
        chefProfileId: true,
      },
    });
    const key = (clientId: string, chefProfileId: string) =>
      `${clientId}:${chefProfileId}`;
    const byPair = new Map<string, PairBooking[]>();
    for (const row of rows) {
      const list = byPair.get(key(row.clientId, row.chefProfileId)) ?? [];
      list.push(row as PairBooking);
      byPair.set(key(row.clientId, row.chefProfileId), list);
    }
    for (const c of pairs) {
      byConversation.set(
        c.id,
        byPair.get(key(c.clientId as string, c.chefProfileId as string)) ?? [],
      );
    }
    return byConversation;
  }

  async bookingsOf(conversation: LoadedConversation): Promise<PairBooking[]> {
    return (await this.pairBookings([conversation])).get(conversation.id) ?? [];
  }

  /**
   * Get-or-create the thread of a (client, batch cooker) pair, and return its id.
   * Also the entry point for the booking flow once it confirms a booking.
   */
  async ensurePair(clientId: string, chefProfileId: string): Promise<string> {
    const chef = await this.prisma.chefProfile.findUnique({
      where: { id: chefProfileId },
      select: { userId: true },
    });
    if (!chef) throw notFound();
    if (chef.userId === clientId) {
      throw new ConflictException({
        code: 'SAME_PERSON',
        message: 'A conversation needs two different people.',
      });
    }
    const where = { clientId_chefProfileId: { clientId, chefProfileId } };
    return this.getOrCreate(where, {
      type: 'chef_client',
      clientId,
      chefProfileId,
      participants: {
        create: [
          { userId: clientId, role: 'client' },
          { userId: chef.userId, role: 'chef' },
        ],
      },
    });
  }

  /** Get-or-create someone's thread with the team, and return its id. */
  async ensureSupport(user: Pick<User, 'id' | 'role'>): Promise<string> {
    return this.getOrCreate(
      { supportUserId: user.id },
      {
        type: 'support',
        supportUserId: user.id,
        participants: {
          create: [
            { userId: user.id, role: user.role === UserRole.chef ? 'chef' : 'client' },
          ],
        },
      },
    );
  }

  /**
   * Two people opening the same thread at the same moment both miss it and both
   * insert: the unique index refuses the second, which then reads the first.
   */
  private async getOrCreate(
    where: Prisma.ConversationWhereUniqueInput,
    create: Prisma.ConversationUncheckedCreateInput,
  ): Promise<string> {
    const existing = await this.prisma.conversation.findUnique({
      where,
      select: { id: true },
    });
    if (existing) return existing.id;
    try {
      const created = await this.prisma.conversation.create({
        data: create,
        select: { id: true },
      });
      return created.id;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const winner = await this.prisma.conversation.findUnique({
        where,
        select: { id: true },
      });
      if (!winner) throw error;
      return winner.id;
    }
  }

  async downloadUrl(conversationId: string, attachmentId: string) {
    const attachment = await this.prisma.messageAttachment.findFirst({
      where: { id: attachmentId, conversationId },
      select: { storagePath: true },
    });
    if (!attachment) {
      throw new NotFoundException({
        code: 'ATTACHMENT_NOT_FOUND',
        message: 'Attachment not found.',
      });
    }
    return this.storage.createDownloadUrl(attachment.storagePath);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /**
   * The local row for a Clerk subject. Read first: `ensurePersistedFromClerk`
   * calls Clerk on every use, which a chat cannot afford per message.
   */
  private async me(clerkUserId: string): Promise<User> {
    return (
      (await this.users.findByClerkId(clerkUserId)) ??
      this.users.ensurePersistedFromClerk(clerkUserId)
    );
  }

  private async loadForParticipant(
    userId: string,
    id: string,
  ): Promise<{ conversation: LoadedConversation; membership: Membership }> {
    const membership = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId: id, userId } },
      include: { conversation: { include: CONVERSATION_INCLUDE } },
    });
    if (!membership) throw notFound();
    return { conversation: membership.conversation, membership };
  }

  private async detailFor(userId: string, id: string): Promise<ConversationDetailView> {
    const { conversation, membership } = await this.loadForParticipant(userId, id);
    const bookings = await this.bookingsOf(conversation);
    const view = this.toView(conversation, membership, bookings, new Date());
    return { ...view, clientCard: await this.clientCard(conversation, membership) };
  }

  /** The household a batch cooker cooks for. Never the street address. */
  private async clientCard(
    conversation: LoadedConversation,
    membership: Membership,
  ): Promise<ClientCardView | null> {
    if (
      conversation.type !== 'chef_client' ||
      membership.role !== 'chef' ||
      !conversation.clientId
    ) {
      return null;
    }
    const profile = await this.prisma.clientProfile.findUnique({
      where: { userId: conversation.clientId },
    });
    if (!profile) return null;
    return {
      city: profile.addressCity,
      householdAdults: profile.householdAdults,
      householdKids: profile.householdKids,
      allergies: allergyLabels(profile),
      dietaryPreferences: profile.dietaryPreferences,
      kitchenNotes: profile.kitchenNotes,
    };
  }

  private async isMasked(conversation: LoadedConversation): Promise<boolean> {
    if (conversation.type !== 'chef_client') return false;
    return !isContactReleased(await this.bookingsOf(conversation), new Date());
  }

  private async assertWritable(conversation: LoadedConversation): Promise<void> {
    this.assertOpen(conversation, await this.bookingsOf(conversation), new Date());
  }

  private assertOpen(
    conversation: LoadedConversation,
    bookings: PairBooking[],
    now: Date,
  ): void {
    if (!writable(conversation, bookings, now)) {
      throw new ConflictException({
        code: 'CONVERSATION_READ_ONLY',
        message:
          'This conversation is closed: no prestation is ahead or recent. ' +
          'Write to support instead.',
      });
    }
  }

  private findByClientMessageId(
    conversationId: string,
    senderUserId: string,
    clientMessageId: string,
  ): Promise<LoadedMessage | null> {
    return this.prisma.message.findFirst({
      where: { conversationId, senderUserId, clientMessageId },
      include: MESSAGE_INCLUDE,
    });
  }

  private toView(
    conversation: LoadedConversation,
    membership: Membership,
    bookings: PairBooking[],
    now: Date,
  ): ConversationView {
    const released =
      conversation.type === 'chef_client' && isContactReleased(bookings, now);
    const masked = conversation.type === 'chef_client' && !released;
    const last = conversation.messages[0];
    return {
      id: conversation.id,
      type: conversation.type,
      viewerRole: membership.role,
      counterpart: counterpartOf(conversation, membership.role, released),
      booking: toBookingSummary(currentBooking(bookings, now)),
      writable: writable(conversation, bookings, now),
      contactReleased: released,
      contactReleaseAt:
        conversation.type === 'chef_client' ? nextContactReleaseAt(bookings, now) : null,
      lastMessage: last ? toMessageView(last, masked) : null,
      lastMessageAt: conversation.lastMessageAt,
      unreadCount: membership.unreadCount,
      createdAt: conversation.createdAt,
    };
  }
}

// ── Pure helpers ────────────────────────────────────────────────────────────

/** A support thread is always open; a client thread follows its bookings. */
function writable(
  conversation: LoadedConversation,
  bookings: PairBooking[],
  now: Date,
): boolean {
  if (conversation.type === 'support') return !conversation.supportUser?.deletedAt;
  // Nobody answers from a deleted account.
  if (conversation.client?.deletedAt || conversation.chefProfile?.user.deletedAt) {
    return false;
  }
  return isWritable(bookings, now);
}

function counterpartOf(
  conversation: LoadedConversation,
  viewerRole: SenderRole,
  released: boolean,
): CounterpartView {
  if (conversation.type === 'support') {
    return { role: 'support', name: SUPPORT_NAME, avatarUrl: null, phone: null };
  }
  if (viewerRole === 'client') {
    const chef = conversation.chefProfile;
    return {
      role: 'chef',
      name: chef?.displayName ?? 'Batch cooker',
      avatarUrl: chef?.user.avatarUrl ?? null,
      phone: released ? (chef?.user.phone ?? null) : null,
    };
  }
  const client = conversation.client;
  return {
    role: 'client',
    name: shortName(client?.fullName),
    avatarUrl: client?.avatarUrl ?? null,
    phone: released ? (client?.phone ?? null) : null,
  };
}

export function participantIds(conversation: LoadedConversation): string[] {
  if (conversation.type === 'support') {
    return conversation.supportUserId ? [conversation.supportUserId] : [];
  }
  return [conversation.clientId, conversation.chefProfile?.user.id].filter(
    (id): id is string => Boolean(id),
  );
}

export function toBookingSummary(booking: PairBooking | null): BookingSummary | null {
  if (!booking) return null;
  return {
    id: booking.id,
    reference: booking.reference,
    status: booking.status,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
  };
}

function toAttachmentViews(message: LoadedMessage): AttachmentView[] {
  return message.attachments.map((a) => ({
    id: a.id,
    fileName: a.fileName,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
  }));
}

/** What a participant reads. `masked`: the thread's contact details are not released. */
export function toMessageView(message: LoadedMessage, masked: boolean): MessageView {
  const hide = masked && message.contactDetected;
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderRole: message.senderRole,
    body: hide ? maskContact(message.body) : message.body,
    contactMasked: hide,
    attachments: toAttachmentViews(message),
    clientMessageId: message.clientMessageId,
    createdAt: message.createdAt,
  };
}

/** What an admin reads: the text as written. */
export function toAdminMessageView(message: LoadedMessage): AdminMessageView {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderRole: message.senderRole,
    body: message.body,
    contactDetected: message.contactDetected,
    senderName: message.sender?.fullName ?? null,
    attachments: toAttachmentViews(message),
    clientMessageId: message.clientMessageId,
    createdAt: message.createdAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
