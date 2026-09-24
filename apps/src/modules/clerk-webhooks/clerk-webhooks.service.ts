import type { WebhookEvent } from '@clerk/backend';
import { verifyWebhook } from '@clerk/backend/webhooks';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AuditService } from '../../common/audit/audit.service';
import { Prisma } from '../../generated/prisma/client';
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
        try {
          await this.users.deleteByClerkId(clerkUserId);
        } catch (error) {
          if (!isForeignKeyViolation(error)) throw error;
          await this.deletionBlocked(clerkUserId, error);
          return;
        }
        this.logger.log(`Removed users row for deleted Clerk user ${clerkUserId}`);
        return;
      }
      default:
        this.logger.debug(`Ignored Clerk webhook type: ${event.type}`);
    }
  }

  /**
   * The account is gone from Clerk, but its bookings still point at the users row
   * (directly, or through the chef profile and its dishes), and the database
   * refuses to lose that history. Retrying cannot change that, so the webhook
   * succeeds: the row stays, and an error log plus an audit row tell an operator
   * to settle it by hand. The person can no longer sign in either way.
   */
  private async deletionBlocked(clerkUserId: string, error: unknown): Promise<void> {
    const user = await this.users.findByClerkId(clerkUserId);
    this.logger.error(
      `Clerk user ${clerkUserId} was deleted, but users.id=${user?.id ?? 'unknown'} ` +
        'is kept: bookings still reference it. Settle it by hand.',
    );
    await this.audit.failed(
      {
        actorType: 'system',
        action: 'user.delete_blocked',
        subjectType: 'user',
        subjectId: user?.id ?? null,
        metadata: { clerkUserId, reason: 'bookings-reference-user' },
      },
      error,
    );
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

/** Prisma's "a foreign key refused this write" (P2003): here, a RESTRICT from bookings. */
function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003';
}
