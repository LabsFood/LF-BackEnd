import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import type { WebhookEvent } from '@clerk/backend';
import { verifyWebhook } from '@clerk/backend/webhooks';

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
  };
  let config: { get: jest.Mock };
  let service: ClerkWebhooksService;

  beforeEach(() => {
    users = {
      upsertFromClerkUserJson: jest.fn().mockResolvedValue({ id: 'db-1' }),
      deleteByClerkId: jest.fn().mockResolvedValue(undefined),
    };
    config = {
      get: jest.fn((key: string) =>
        key === 'clerk.webhookSigningSecret' ? 'whsec_test' : undefined,
      ),
    };
    service = new ClerkWebhooksService(
      config as unknown as ConfigService,
      users as unknown as UsersService,
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
    });
  });

  describe('verifyAndHandle', () => {
    it('throws when signing secret is missing', async () => {
      config.get.mockReturnValue(undefined);
      await expect(
        service.verifyAndHandle('{}', new Headers()),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
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
