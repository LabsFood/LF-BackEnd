import type { WebhookEvent } from '@clerk/backend';
import { verifyWebhook } from '@clerk/backend/webhooks';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { UsersService } from '../users/users.service';

@Injectable()
export class ClerkWebhooksService {
  private readonly logger = new Logger(ClerkWebhooksService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly users: UsersService,
  ) {}

  async handleVerifiedEvent(event: WebhookEvent): Promise<void> {
    switch (event.type) {
      case 'user.created':
      case 'user.updated': {
        const user = await this.users.upsertFromClerkUserJson(event.data);
        this.logger.log(`Synced Clerk user ${event.data.id} → users.id=${user.id}`);
        return;
      }
      case 'user.deleted': {
        const clerkUserId = event.data.id;
        if (!clerkUserId) {
          this.logger.warn('user.deleted webhook missing id; skipping');
          return;
        }
        await this.users.deleteByClerkId(clerkUserId);
        this.logger.log(`Removed users row for deleted Clerk user ${clerkUserId}`);
        return;
      }
      default:
        this.logger.debug(`Ignored Clerk webhook type: ${event.type}`);
    }
  }

  async verifyAndHandle(rawBody: string, headers: Headers): Promise<void> {
    const signingSecret = this.config.get<string>('clerk.webhookSigningSecret');
    if (!signingSecret) {
      throw new ServiceUnavailableException(
        'Clerk webhooks are not configured (CLERK_WEBHOOK_SIGNING_SECRET missing).',
      );
    }

    const request = new Request('http://clerk-webhook/internal', {
      method: 'POST',
      headers,
      body: rawBody,
    });
    const event = await verifyWebhook(request, { signingSecret });
    await this.handleVerifiedEvent(event);
  }
}
