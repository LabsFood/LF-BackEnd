import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SentryCron } from '@sentry/nestjs';

import { BrevoService } from '../../../integrations/brevo.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { shortName } from '../domain/messaging.rules';
import { SUPPORT_NAME } from './messaging.service';

/** A message left unread this long is worth an email. */
const UNREAD_DELAY_MINUTES = 10;
/** Older than this, the email would be about a conversation long gone cold. */
const MAX_AGE_HOURS = 24;

interface Claimed {
  conversation_id: string;
  user_id: string;
  role: 'client' | 'chef' | 'support';
  unread_count: number;
}

/**
 * Emails people about messages they have not opened.
 *
 * One email per burst: a participant is written to once after the last message of
 * a run of messages, and not again until something newer arrives. The email never
 * quotes the message: it would bypass the masking of contact details.
 *
 * Safe on several replicas: the `UPDATE … RETURNING` claims each recipient, so two
 * instances firing together cannot both get the same row.
 */
@Injectable()
export class MessagingNotifierCron {
  private readonly logger = new Logger(MessagingNotifierCron.name);
  private readonly publicSiteUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly brevo: BrevoService,
    config: ConfigService,
  ) {
    this.publicSiteUrl = config
      .get<string>('chefOnboarding.publicSiteUrl', 'https://batchcooking.labsfood.fr')
      .replace(/\/$/, '');
  }

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'messaging-unread-emails' })
  @SentryCron('messaging-unread-emails', {
    checkinMargin: 5,
    maxRuntime: 5,
    failureIssueThreshold: 3,
  })
  async run(): Promise<void> {
    // Without a template nothing can be sent: leave the rows unclaimed, so the
    // emails start the day the template is configured.
    if (!this.brevo.configured || !this.brevo.templates.newMessage) return;

    try {
      const claimed = await this.prisma.$queryRaw<Claimed[]>`
        UPDATE "conversation_participants" p
        SET "last_emailed_at" = now()
        FROM "conversations" c
        WHERE c."id" = p."conversation_id"
          AND p."unread_count" > 0
          AND c."last_message_at" < now() - ${UNREAD_DELAY_MINUTES}::int * interval '1 minute'
          AND c."last_message_at" > now() - ${MAX_AGE_HOURS}::int * interval '1 hour'
          AND (p."last_emailed_at" IS NULL OR p."last_emailed_at" < c."last_message_at")
        RETURNING p."conversation_id", p."user_id", p."role", p."unread_count"
      `;
      for (const row of claimed) await this.notify(row);
      if (claimed.length > 0) {
        this.logger.log(`Unread-message emails: ${claimed.length} recipient(s).`);
      }
    } catch (error) {
      this.logger.error(
        'Unread-message email job failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async notify(row: Claimed): Promise<void> {
    const [recipient, conversation] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: row.user_id },
        select: { email: true, fullName: true, deletedAt: true },
      }),
      this.prisma.conversation.findUnique({
        where: { id: row.conversation_id },
        select: {
          type: true,
          client: { select: { fullName: true } },
          chefProfile: { select: { displayName: true } },
        },
      }),
    ]);
    if (!recipient || recipient.deletedAt || !conversation) return;

    const senderName =
      conversation.type === 'support'
        ? SUPPORT_NAME
        : row.role === 'client'
          ? (conversation.chefProfile?.displayName ?? 'Votre batch cooker')
          : shortName(conversation.client?.fullName);
    const space =
      row.role === 'chef' ? 'espace-chef/messagerie' : 'espace-client/messages';

    await this.brevo.sendTemplate({
      templateId: this.brevo.templates.newMessage,
      to: { email: recipient.email, name: recipient.fullName ?? undefined },
      label: 'new-message',
      params: {
        firstName: recipient.fullName?.trim().split(/\s+/)[0] ?? '',
        senderName,
        unreadCount: row.unread_count,
        conversationUrl: `${this.publicSiteUrl}/${space}?c=${row.conversation_id}`,
      },
    });
  }
}
