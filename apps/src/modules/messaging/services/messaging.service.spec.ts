import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { PrismaService } from '../../../prisma/prisma.service';
import { UsersService } from '../../users/users.service';
import { CONTACT_MASK } from '../domain/contact-detector';
import { MessagingEventsService } from './messaging-events.service';
import { MessagingRateLimiter } from './messaging-rate-limiter';
import { MessagingStorageService } from './messaging-storage.service';
import { LoadedConversation, MessagingService } from './messaging.service';

const CLIENT = 'user-client';
const CHEF_USER = 'user-chef';
const CONVERSATION = 'conv-1';
const HOUR = 3_600_000;

const person = (id: string, fullName: string, phone: string) => ({
  id,
  fullName,
  email: `${id}@exemple.fr`,
  phone,
  avatarUrl: null,
  role: 'client',
  deletedAt: null,
});

const conversation = (overrides: Partial<LoadedConversation> = {}) =>
  ({
    id: CONVERSATION,
    type: 'chef_client',
    clientId: CLIENT,
    chefProfileId: 'chef-profile',
    supportUserId: null,
    lastMessageAt: null,
    contactFlaggedAt: null,
    adminUnreadCount: 0,
    createdAt: new Date('2026-10-01T09:00:00.000Z'),
    updatedAt: new Date('2026-10-01T09:00:00.000Z'),
    client: person(CLIENT, 'Sophie Marchand', '0611111111'),
    chefProfile: {
      id: 'chef-profile',
      displayName: 'Marie Dupont',
      user: person(CHEF_USER, 'Marie Dupont', '0622222222'),
    },
    supportUser: null,
    messages: [],
    ...overrides,
  }) as unknown as LoadedConversation;

const supportConversation = () =>
  conversation({
    type: 'support',
    clientId: null,
    chefProfileId: null,
    supportUserId: CLIENT,
    client: null,
    chefProfile: null,
    supportUser: person(CLIENT, 'Sophie Marchand', '0611111111'),
  } as unknown as Partial<LoadedConversation>);

/** A booking between the two, starting `inHours` from now. */
const booking = (status: string, inHours: number) => ({
  id: 'booking-1',
  reference: 'LF-2026-0142',
  status,
  startsAt: new Date(Date.now() + inHours * HOUR),
  endsAt: new Date(Date.now() + (inHours + 4) * HOUR),
  clientId: CLIENT,
  chefProfileId: 'chef-profile',
});

describe('MessagingService', () => {
  let service: MessagingService;
  let tx: {
    message: { create: jest.Mock };
    conversation: { update: jest.Mock };
    conversationParticipant: { updateMany: jest.Mock };
  };
  let prisma: {
    conversationParticipant: { findUnique: jest.Mock; update: jest.Mock };
    booking: { findMany: jest.Mock };
    message: { findFirst: jest.Mock; findMany: jest.Mock };
    clientProfile: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let storage: { pathFor: jest.Mock; statObject: jest.Mock; createUploadUrl: jest.Mock };
  let rateLimiter: { assertCanSend: jest.Mock };
  let events: { publish: jest.Mock };

  /** The caller takes part in `loaded`, from the given side. */
  const asParticipant = (loaded: LoadedConversation, role: 'client' | 'chef') =>
    prisma.conversationParticipant.findUnique.mockResolvedValue({
      role,
      unreadCount: 2,
      conversationId: loaded.id,
      conversation: loaded,
    });

  beforeEach(() => {
    tx = {
      message: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'msg-1',
          sender: { fullName: 'Sophie Marchand' },
          ...data,
          attachments: [],
        })),
      },
      conversation: { update: jest.fn() },
      conversationParticipant: { updateMany: jest.fn() },
    };
    prisma = {
      conversationParticipant: { findUnique: jest.fn(), update: jest.fn() },
      booking: { findMany: jest.fn().mockResolvedValue([booking('confirmed', 100)]) },
      message: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      clientProfile: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
    };
    storage = {
      pathFor: jest.fn(
        (conv: string, user: string, id: string) => `conversations/${conv}/${user}/${id}`,
      ),
      statObject: jest
        .fn()
        .mockResolvedValue({ sizeBytes: 1200, mimeType: 'image/jpeg' }),
      createUploadUrl: jest.fn(),
    };
    rateLimiter = { assertCanSend: jest.fn() };
    events = { publish: jest.fn().mockResolvedValue(undefined) };
    const users = {
      findByClerkId: jest.fn().mockResolvedValue({ id: CLIENT, role: 'client' }),
    };

    service = new MessagingService(
      prisma as unknown as PrismaService,
      users as unknown as UsersService,
      storage as unknown as MessagingStorageService,
      rateLimiter as unknown as MessagingRateLimiter,
      events as unknown as MessagingEventsService,
    );
  });

  describe('access', () => {
    it('answers 404 to someone who does not take part', async () => {
      prisma.conversationParticipant.findUnique.mockResolvedValue(null);

      await expect(service.getMine('clerk_1', CONVERSATION)).rejects.toThrow(
        NotFoundException,
      );
      await expect(
        service.sendMessage('clerk_1', CONVERSATION, { body: 'Bonjour' }),
      ).rejects.toThrow(NotFoundException);
      expect(tx.message.create).not.toHaveBeenCalled();
    });
  });

  describe('sending', () => {
    it('stores the text as written and serves it masked before the release', async () => {
      asParticipant(conversation(), 'client');

      const sent = await service.sendMessage('clerk_1', CONVERSATION, {
        body: 'Appelez-moi au 06 12 34 56 78',
      });

      expect(tx.message.create.mock.calls[0][0].data).toMatchObject({
        body: 'Appelez-moi au 06 12 34 56 78',
        contactDetected: true,
        senderRole: 'client',
        senderUserId: CLIENT,
      });
      expect(sent.body).toBe(`Appelez-moi au ${CONTACT_MASK}`);
      expect(sent.contactMasked).toBe(true);
    });

    it('flags the conversation and counts the message as unread for the other side', async () => {
      asParticipant(conversation(), 'client');

      await service.sendMessage('clerk_1', CONVERSATION, { body: 'mail: a@b.fr' });

      expect(tx.conversation.update.mock.calls[0][0].data).toMatchObject({
        contactFlaggedAt: expect.any(Date),
        lastMessageAt: expect.any(Date),
      });
      expect(tx.conversationParticipant.updateMany).toHaveBeenCalledWith({
        where: { conversationId: CONVERSATION, userId: { not: CLIENT } },
        data: { unreadCount: { increment: 1 } },
      });
    });

    it('leaves the text readable once the contact details are released', async () => {
      prisma.booking.findMany.mockResolvedValue([booking('confirmed', 24)]);
      asParticipant(conversation(), 'client');

      const sent = await service.sendMessage('clerk_1', CONVERSATION, {
        body: 'Appelez-moi au 06 12 34 56 78',
      });

      expect(sent.body).toBe('Appelez-moi au 06 12 34 56 78');
      expect(sent.contactMasked).toBe(false);
      // Still recorded: the thread is masked again after the prestation.
      expect(tx.message.create.mock.calls[0][0].data.contactDetected).toBe(true);
    });

    it('tells both people and the admins, each with their own text', async () => {
      asParticipant(conversation(), 'client');

      await service.sendMessage('clerk_1', CONVERSATION, { body: 'Tel 0612345678' });

      const envelope = events.publish.mock.calls[0][0];
      expect(envelope.userIds).toEqual([CLIENT, CHEF_USER]);
      expect(envelope.toUsers.data.message.body).toBe(`Tel ${CONTACT_MASK}`);
      expect(envelope.toAdmins.data.message.body).toBe('Tel 0612345678');
    });

    it('refuses a closed conversation', async () => {
      prisma.booking.findMany.mockResolvedValue([booking('completed', -30 * 24)]);
      asParticipant(conversation(), 'client');

      await expect(
        service.sendMessage('clerk_1', CONVERSATION, { body: 'Bonjour' }),
      ).rejects.toThrow(ConflictException);
      expect(tx.message.create).not.toHaveBeenCalled();
    });

    it('refuses a message with neither text nor file', async () => {
      asParticipant(conversation(), 'client');

      await expect(
        service.sendMessage('clerk_1', CONVERSATION, { body: '   ' }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('returns the stored message on a retry instead of posting twice', async () => {
      asParticipant(conversation(), 'client');
      prisma.message.findFirst.mockResolvedValue({
        id: 'msg-0',
        conversationId: CONVERSATION,
        senderRole: 'client',
        body: 'Bonjour',
        contactDetected: false,
        clientMessageId: 'retry-1',
        createdAt: new Date(),
        attachments: [],
        sender: null,
      });

      const sent = await service.sendMessage('clerk_1', CONVERSATION, {
        body: 'Bonjour',
        clientMessageId: 'retry-1',
      });

      expect(sent.id).toBe('msg-0');
      expect(tx.message.create).not.toHaveBeenCalled();
      expect(events.publish).not.toHaveBeenCalled();
    });

    it('checks the rate limit before reading anything', async () => {
      rateLimiter.assertCanSend.mockRejectedValue(new Error('RATE_LIMITED'));

      await expect(
        service.sendMessage('clerk_1', CONVERSATION, { body: 'Bonjour' }),
      ).rejects.toThrow('RATE_LIMITED');
      expect(prisma.conversationParticipant.findUnique).not.toHaveBeenCalled();
    });

    it('attaches only files found under the sender’s own upload path', async () => {
      asParticipant(conversation(), 'client');

      await service.sendMessage('clerk_1', CONVERSATION, {
        attachments: [{ uploadId: 'up_1', fileName: 'plan.jpg' }],
      });

      expect(storage.pathFor).toHaveBeenCalledWith(CONVERSATION, CLIENT, 'up_1');
      expect(tx.message.create.mock.calls[0][0].data.attachments.create).toEqual([
        {
          conversationId: CONVERSATION,
          uploaderUserId: CLIENT,
          storagePath: `conversations/${CONVERSATION}/${CLIENT}/up_1`,
          fileName: 'plan.jpg',
          sizeBytes: 1200,
          mimeType: 'image/jpeg',
        },
      ]);
    });
  });

  describe('support conversations', () => {
    it('are never masked, always open, and count as unread for the team', async () => {
      prisma.booking.findMany.mockResolvedValue([]);
      asParticipant(supportConversation(), 'client');

      const sent = await service.sendMessage('clerk_1', CONVERSATION, {
        body: 'Rappelez-moi au 06 12 34 56 78',
      });

      expect(sent.body).toBe('Rappelez-moi au 06 12 34 56 78');
      expect(tx.message.create.mock.calls[0][0].data.contactDetected).toBe(false);
      expect(tx.conversation.update.mock.calls[0][0].data).toMatchObject({
        adminUnreadCount: { increment: 1 },
      });
    });
  });

  describe('an admin writing as the team', () => {
    it('is not policed and can write in a closed conversation', async () => {
      prisma.booking.findMany.mockResolvedValue([]);

      const { message } = await service.postMessage(
        conversation(),
        { userId: 'admin-1', role: 'support', isAdmin: true },
        { body: 'Écrivez à support@labsfood.fr' },
      );

      expect(message.contactDetected).toBe(false);
      expect(tx.conversation.update.mock.calls[0][0].data).not.toHaveProperty(
        'adminUnreadCount',
      );
    });
  });

  describe('the conversation header', () => {
    it('hides the phone number until the release, then shows it', async () => {
      asParticipant(conversation(), 'client');
      const before = await service.getMine('clerk_1', CONVERSATION);
      expect(before.contactReleased).toBe(false);
      expect(before.counterpart).toMatchObject({ name: 'Marie Dupont', phone: null });
      expect(before.contactReleaseAt).toBeInstanceOf(Date);

      prisma.booking.findMany.mockResolvedValue([booking('confirmed', 24)]);
      const after = await service.getMine('clerk_1', CONVERSATION);
      expect(after.contactReleased).toBe(true);
      expect(after.counterpart.phone).toBe('0622222222');
    });

    it('shows a batch cooker a shortened client name', async () => {
      asParticipant(conversation(), 'chef');

      const view = await service.getMine('clerk_1', CONVERSATION);

      expect(view.viewerRole).toBe('chef');
      expect(view.counterpart.name).toBe('Sophie M.');
    });
  });

  describe('reading messages', () => {
    it('serves a page oldest first, with a cursor when there is more', async () => {
      asParticipant(conversation(), 'client');
      const row = (id: string) => ({
        id,
        conversationId: CONVERSATION,
        senderRole: 'chef',
        body: id,
        contactDetected: false,
        clientMessageId: null,
        createdAt: new Date(),
        attachments: [],
        sender: null,
      });
      // Newest first from the database, one more than asked.
      prisma.message.findMany.mockResolvedValue([row('m3'), row('m2'), row('m1')]);

      const page = await service.listMessages('clerk_1', CONVERSATION, { limit: 2 });

      expect(page.data.map((m) => m.id)).toEqual(['m2', 'm3']);
      expect(page.nextCursor).toBe('m2');
    });
  });
});
