import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import type { WebhookEvent } from '@clerk/backend';
import { verifyWebhook } from '@clerk/backend/webhooks';

import { AuditService } from '../../common/audit/audit.service';
import { UsersService } from '../users/users.service';
import { ClerkWebhooksService } from './clerk-webhooks.service';

jest.mock('@clerk/backend/webhooks', () => ({
  verifyWebhook: jest.fn(),
}));

const mockedVerifyWebhook = verifyWebhook as jest.MockedFunction<typeof verifyWebhook>;

describe('ClerkWebhooksService', () => {
  let users: {
    upsertFromClerkUserJson: jest.Mock;
    deleteByClerkId: jest.Mock;
    findByClerkId: jest.Mock;
  };
  let audit: { record: jest.Mock };
  let config: { get: jest.Mock };
  let service: ClerkWebhooksService;

  beforeEach(() => {
    users = {
      upsertFromClerkUserJson: jest.fn().mockResolvedValue({ id: 'db-1' }),
      deleteByClerkId: jest.fn().mockResolvedValue('deleted'),
      findByClerkId: jest.fn().mockResolvedValue({ id: 'db-1' }),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    config = {
      get: jest.fn((key: string) =>
        key === 'clerk.webhookSigningSecret' ? 'whsec_test' : undefined,
      ),
    };
    service = new ClerkWebhooksService(
      config as unknown as ConfigService,
      users as unknown as UsersService,
      audit as unknown as AuditService,
    );
    mockedVerifyWebhook.mockReset();
  });

  describe('handleVerifiedEvent', () => {
    it('upserts on user.created', async () => {
      const data = { id: 'user_1', email_addresses: [] };
      await service.handleVerifiedEvent({
        type: 'user.created',
        object: 'event',
        data,
        event_attributes: { http_request: { client_ip: '', user_agent: '' } },
      } as unknown as WebhookEvent);

      expect(users.upsertFromClerkUserJson).toHaveBeenCalledWith(data);
    });

    it('deletes on user.deleted', async () => {
      await service.handleVerifiedEvent({
        type: 'user.deleted',
        object: 'event',
        data: { id: 'user_1', deleted: true },
        event_attributes: { http_request: { client_ip: '', user_agent: '' } },
      } as unknown as WebhookEvent);

      expect(users.deleteByClerkId).toHaveBeenCalledWith('user_1');
      expect(audit.record).not.toHaveBeenCalled();
    });

    const deleted = {
      type: 'user.deleted',
      object: 'event',
      data: { id: 'user_1', deleted: true },
      event_attributes: { http_request: { client_ip: '', user_agent: '' } },
    } as unknown as WebhookEvent;

    it('records a user their bookings kept as anonymised', async () => {
      users.deleteByClerkId.mockResolvedValue('anonymised');

      await expect(service.handleVerifiedEvent(deleted)).resolves.toBeUndefined();

      expect(audit.record).toHaveBeenCalledWith({
        actorType: 'system',
        action: 'user.anonymised',
        subjectType: 'user',
        subjectId: 'db-1',
        metadata: { clerkUserId: 'user_1', reason: 'bookings-reference-user' },
      });
    });

    it('lets any failure through, so Clerk retries it', async () => {
      const outage = new Error('connection lost');
      users.deleteByClerkId.mockRejectedValue(outage);

      await expect(service.handleVerifiedEvent(deleted)).rejects.toBe(outage);
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('verifyAndHandle', () => {
    it('throws when signing secret is missing', async () => {
      config.get.mockReturnValue(undefined);
      await expect(service.verifyAndHandle('{}', new Headers())).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('verifies Svix signature then dispatches', async () => {
      const event = {
        type: 'user.updated',
        object: 'event',
        data: { id: 'user_2', email_addresses: [] },
        event_attributes: { http_request: { client_ip: '', user_agent: '' } },
      } as unknown as WebhookEvent;
      mockedVerifyWebhook.mockResolvedValue(event);

      await service.verifyAndHandle('{"ok":true}', new Headers({ 'svix-id': 'msg_1' }));

      expect(mockedVerifyWebhook).toHaveBeenCalled();
      expect(users.upsertFromClerkUserJson).toHaveBeenCalledWith(event.data);
    });
  });
});
