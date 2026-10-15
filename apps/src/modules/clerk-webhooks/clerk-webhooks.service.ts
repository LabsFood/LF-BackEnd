import type { WebhookEvent } from '@clerk/backend';
import { verifyWebhook } from '@clerk/backend/webhooks';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AuditService } from '../../common/audit/audit.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class ClerkWebhooksService {
  private readonly logger = new Logger(ClerkWebhooksService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
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
        if ((await this.users.deleteByClerkId(clerkUserId)) === 'deleted') {
          this.logger.log(`Removed users row for deleted Clerk user ${clerkUserId}`);
          return;
        }
        await this.anonymised(clerkUserId);
        return;
      }
      default:
        this.logger.debug(`Ignored Clerk webhook type: ${event.type}`);
    }
  }

  /** Bookings still reference the row, so it was kept with its personal data blanked. */
  private async anonymised(clerkUserId: string): Promise<void> {
    const user = await this.users.findByClerkId(clerkUserId);
    this.logger.log(
      `Anonymised users.id=${user?.id ?? 'unknown'} for deleted Clerk user ` +
        `${clerkUserId}: bookings still reference it`,
    );
    await this.audit.record({
      actorType: 'system',
      action: 'user.anonymised',
      subjectType: 'user',
      subjectId: user?.id ?? null,
      metadata: { clerkUserId, reason: 'bookings-reference-user' },
    });
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
