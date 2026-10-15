import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AuditService } from '../../common/audit/audit.service';
import { BrevoService } from '../../integrations/brevo.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { ContactService } from './contact.service';

const STORED = {
  id: 'msg-1',
  source: 'labsfood',
  name: 'Sophie Marchand',
  email: 'sophie@exemple.fr',
  phone: null,
  subject: 'Batch cooking',
  message: 'Bonjour, intervenez-vous à Nice ?',
  status: 'new',
  createdAt: new Date('2026-10-11T09:00:00.000Z'),
  replies: [],
};

const FORM = {
  source: 'labsfood' as const,
  name: 'Sophie Marchand',
  email: 'Sophie@Exemple.fr',
  message: 'Bonjour, intervenez-vous à Nice ?',
};

describe('ContactService', () => {
  let service: ContactService;
  let prisma: {
    contactMessage: {
      create: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    contactMessageReply: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let brevo: { sendTemplate: jest.Mock; templates: Record<string, number> };
  let audit: { record: jest.Mock; failed: jest.Mock };

  const build = (notificationEmail?: string) =>
    new ContactService(
      prisma as unknown as PrismaService,
      brevo as unknown as BrevoService,
      {
        findByClerkId: jest.fn().mockResolvedValue({ id: 'admin-1' }),
      } as unknown as UsersService,
      audit as unknown as AuditService,
      {
        get: (key: string, fallback?: string) =>
          key === 'contact.notificationEmail' ? notificationEmail : fallback,
      } as unknown as ConfigService,
    );

  beforeEach(() => {
    prisma = {
      contactMessage: {
        create: jest.fn().mockResolvedValue(STORED),
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn().mockResolvedValue(STORED),
        update: jest.fn().mockResolvedValue({ ...STORED, status: 'replied' }),
      },
      contactMessageReply: { create: jest.fn() },
      $transaction: jest.fn(async (operations: unknown[]) => Promise.all(operations)),
    };
    brevo = {
      sendTemplate: jest.fn().mockResolvedValue({ sent: true }),
      templates: { contactReceivedAdmin: 21, contactReply: 22 },
    };
    audit = { record: jest.fn(), failed: jest.fn() };
    service = build('contact@labsfood.fr');
  });

  describe('a visitor sends the form', () => {
    it('stores the message and tells the team, who can reply straight to the visitor', async () => {
      await expect(service.submit(FORM)).resolves.toEqual({ received: true });

      expect(prisma.contactMessage.create.mock.calls[0][0].data).toMatchObject({
        source: 'labsfood',
        email: 'sophie@exemple.fr',
        subject: 'Demande générale',
        phone: null,
      });
      await Promise.resolve();
      expect(brevo.sendTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          templateId: 21,
          to: { email: 'contact@labsfood.fr' },
          replyTo: { email: 'sophie@exemple.fr', name: 'Sophie Marchand' },
        }),
      );
    });

    it('keeps the message even when the email provider is down', async () => {
      brevo.sendTemplate.mockRejectedValue(new Error('Brevo is down'));

      await expect(service.submit(FORM)).resolves.toEqual({ received: true });
      expect(prisma.contactMessage.create).toHaveBeenCalled();
    });

    it('sends no email when no address is configured', async () => {
      service = build(undefined);

      await service.submit(FORM);
      await Promise.resolve();

      expect(prisma.contactMessage.create).toHaveBeenCalled();
      expect(brevo.sendTemplate).not.toHaveBeenCalled();
    });

    it('refuses a sixth message in the hour from the same email address', async () => {
      prisma.contactMessage.count.mockResolvedValue(5);

      await expect(service.submit(FORM)).rejects.toMatchObject({ status: 429 });
      expect(prisma.contactMessage.count.mock.calls[0][0].where.email).toBe(
        'sophie@exemple.fr',
      );
      expect(prisma.contactMessage.create).not.toHaveBeenCalled();
      expect(brevo.sendTemplate).not.toHaveBeenCalled();
    });

    it('answers a robot like a person, and keeps nothing of it', async () => {
      await expect(
        service.submit({ ...FORM, website: 'https://spam.example' }),
      ).resolves.toEqual({ received: true });

      expect(prisma.contactMessage.create).not.toHaveBeenCalled();
      expect(brevo.sendTemplate).not.toHaveBeenCalled();
    });
  });

  describe('an admin replies', () => {
    it('emails the answer, records it and marks the message replied', async () => {
      const view = await service.reply(
        'clerk_admin',
        'msg-1',
        'Oui, nous venons à Nice.',
      );

      expect(brevo.sendTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          templateId: 22,
          to: { email: 'sophie@exemple.fr', name: 'Sophie Marchand' },
          replyTo: { email: 'contact@labsfood.fr' },
          params: expect.objectContaining({
            firstName: 'Sophie',
            reply: 'Oui, nous venons à Nice.',
          }),
        }),
      );
      expect(prisma.contactMessageReply.create).toHaveBeenCalledWith({
        data: {
          contactMessageId: 'msg-1',
          body: 'Oui, nous venons à Nice.',
          sentByUserId: 'admin-1',
        },
      });
      expect(view.status).toBe('replied');
      expect(audit.record).toHaveBeenCalled();
    });

    it('records nothing when the email did not leave', async () => {
      brevo.sendTemplate.mockResolvedValue({ sent: false });

      await expect(service.reply('clerk_admin', 'msg-1', 'Bonjour')).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(prisma.contactMessageReply.create).not.toHaveBeenCalled();
      expect(prisma.contactMessage.update).not.toHaveBeenCalled();
      expect(audit.failed).toHaveBeenCalled();
    });

    it('answers 404 for a message that does not exist', async () => {
      prisma.contactMessage.findUnique.mockResolvedValue(null);

      await expect(service.reply('clerk_admin', 'nope', 'Bonjour')).rejects.toThrow(
        NotFoundException,
      );
      expect(brevo.sendTemplate).not.toHaveBeenCalled();
    });
  });
});
