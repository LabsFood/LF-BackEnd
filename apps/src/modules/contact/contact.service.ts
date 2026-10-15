import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AuditService } from '../../common/audit/audit.service';
import {
  Paginated,
  buildPaginationMeta,
  resolvePageBounds,
} from '../../common/dto/pagination.dto';
import { Prisma } from '../../generated/prisma/client';
import { BrevoService } from '../../integrations/brevo.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import {
  CONTACT_RATE_LIMIT,
  DEFAULT_CONTACT_SUBJECT,
  ListContactMessagesQueryDto,
  SubmitContactMessageDto,
  UpdateContactMessageDto,
} from './dto/contact.dto';

const WITH_REPLIES = {
  replies: {
    orderBy: { createdAt: 'asc' },
    include: { sentBy: { select: { fullName: true } } },
  },
} satisfies Prisma.ContactMessageInclude;

type Loaded = Prisma.ContactMessageGetPayload<{ include: typeof WITH_REPLIES }>;

const SOURCE_LABEL: Record<string, string> = {
  labsfood: 'labsfood.fr',
  batchcooking: 'batchcooking.labsfood.fr',
};

const notFound = () =>
  new NotFoundException({
    code: 'CONTACT_MESSAGE_NOT_FOUND',
    message: 'Contact message not found.',
  });

/**
 * The contact forms of the public sites, and the inbox the team reads them in.
 *
 * A sender has no account. The message is stored first and the team told second:
 * an email outage must never lose what a visitor wrote.
 */
@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);
  private readonly notificationEmail?: string;
  private readonly adminSiteUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly brevo: BrevoService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.notificationEmail = config.get<string>('contact.notificationEmail');
    this.adminSiteUrl = config
      .get<string>('contact.adminSiteUrl', 'https://admin.labsfood.fr')
      .replace(/\/$/, '');
  }

  /** `POST /contact-messages`, public. */
  async submit(dto: SubmitContactMessageDto): Promise<{ received: true }> {
    // A robot gets the same answer as a person, so it learns nothing, and its
    // message is not kept.
    if (dto.website?.trim()) {
      this.logger.warn(`Contact form (${dto.source}): honeypot filled, message dropped.`);
      return { received: true };
    }

    const email = dto.email.toLowerCase();
    await this.assertUnderEmailLimit(email);

    const message = await this.prisma.contactMessage.create({
      data: {
        source: dto.source,
        name: dto.name,
        email,
        phone: dto.phone || null,
        subject: dto.subject || DEFAULT_CONTACT_SUBJECT,
        message: dto.message,
      },
    });

    // Not awaited: the visitor's confirmation does not wait on the email provider.
    void this.notifyTeam(message);
    return { received: true };
  }

  async list(
    query: ListContactMessagesQueryDto,
  ): Promise<Paginated<ReturnType<typeof toView>>> {
    const bounds = resolvePageBounds(query);
    const where: Prisma.ContactMessageWhereInput = query.status
      ? { status: query.status }
      : {};
    const [rows, total] = await Promise.all([
      this.prisma.contactMessage.findMany({
        where,
        include: WITH_REPLIES,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: bounds.skip,
        take: bounds.take,
      }),
      this.prisma.contactMessage.count({ where }),
    ]);
    return { data: rows.map(toView), meta: buildPaginationMeta(bounds, total) };
  }

  /** How many messages sit in each status: the tabs and the sidebar badge. */
  async counts(): Promise<Record<'new' | 'read' | 'replied' | 'archived', number>> {
    const groups = await this.prisma.contactMessage.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const counts = { new: 0, read: 0, replied: 0, archived: 0 };
    for (const group of groups) counts[group.status] = group._count._all;
    return counts;
  }

  async get(id: string) {
    return toView(await this.load(id));
  }

  async updateStatus(id: string, dto: UpdateContactMessageDto) {
    await this.load(id);
    const updated = await this.prisma.contactMessage.update({
      where: { id },
      data: { status: dto.status },
      include: WITH_REPLIES,
    });
    return toView(updated);
  }

  /**
   * Emails the answer to the sender, then records it.
   *
   * In that order: a reply that did not leave must not be shown as sent, so
   * nothing is stored and the admin is told, instead of a "replied" that reached
   * nobody.
   */
  async reply(clerkUserId: string, id: string, body: string, requestId?: string) {
    const message = await this.load(id);
    const admin =
      (await this.users.findByClerkId(clerkUserId)) ??
      (await this.users.ensurePersistedFromClerk(clerkUserId));

    const { sent } = await this.brevo.sendTemplate({
      templateId: this.brevo.templates.contactReply,
      to: { email: message.email, name: message.name },
      // The sender answers the team, not the no-reply address.
      ...(this.notificationEmail ? { replyTo: { email: this.notificationEmail } } : {}),
      label: 'contact-reply',
      params: {
        firstName: firstNameOf(message.name),
        subject: message.subject,
        reply: body,
        originalMessage: message.message,
      },
    });
    if (!sent) {
      await this.audit.failed(
        {
          actorType: 'admin',
          actorUserId: admin.id,
          action: 'contact.replied',
          subjectType: 'contact_message',
          subjectId: id,
          requestId,
        },
        'reply email not sent',
      );
      throw new ServiceUnavailableException({
        code: 'EMAIL_NOT_SENT',
        message:
          'The reply could not be emailed, so it was not recorded. Check ' +
          'BREVO_API_KEY and BREVO_TPL_CONTACT_REPLY.',
      });
    }

    const [, updated] = await this.prisma.$transaction([
      this.prisma.contactMessageReply.create({
        data: { contactMessageId: id, body, sentByUserId: admin.id },
      }),
      this.prisma.contactMessage.update({
        where: { id },
        data: { status: 'replied' },
        include: WITH_REPLIES,
      }),
    ]);
    await this.audit.record({
      actorType: 'admin',
      actorUserId: admin.id,
      action: 'contact.replied',
      subjectType: 'contact_message',
      subjectId: id,
      requestId,
    });
    return toView(updated);
  }

  /**
   * The throttler caps what one IP address sends; this caps what one email
   * address sends, whichever machines it comes from. Counted from the stored
   * messages, so it holds across API instances and restarts.
   */
  private async assertUnderEmailLimit(email: string): Promise<void> {
    const recent = await this.prisma.contactMessage.count({
      where: {
        email,
        createdAt: { gte: new Date(Date.now() - CONTACT_RATE_LIMIT.windowMs) },
      },
    });
    if (recent >= CONTACT_RATE_LIMIT.limit) {
      throw new HttpException(
        {
          code: 'TOO_MANY_MESSAGES',
          message: `No more than ${CONTACT_RATE_LIMIT.limit} messages per hour from one email address.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async load(id: string): Promise<Loaded> {
    const message = await this.prisma.contactMessage.findUnique({
      where: { id },
      include: WITH_REPLIES,
    });
    if (!message) throw notFound();
    return message;
  }

  /** Best-effort: the message is in the inbox whether or not this email leaves. */
  private async notifyTeam(message: {
    id: string;
    source: string;
    name: string;
    email: string;
    phone: string | null;
    subject: string;
    message: string;
  }): Promise<void> {
    if (!this.notificationEmail) return;
    try {
      await this.brevo.sendTemplate({
        templateId: this.brevo.templates.contactReceivedAdmin,
        to: { email: this.notificationEmail },
        // "Reply" in the mailbox writes straight to the visitor.
        replyTo: { email: message.email, name: message.name },
        label: 'contact-received-admin',
        params: {
          name: message.name,
          email: message.email,
          phone: message.phone ?? '',
          subject: message.subject,
          message: message.message,
          site: SOURCE_LABEL[message.source] ?? message.source,
          inboxUrl: `${this.adminSiteUrl}/contact?m=${message.id}`,
        },
      });
    } catch (error) {
      this.logger.error(
        `Contact notification failed for ${message.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

function toView(message: Loaded) {
  return {
    id: message.id,
    source: message.source,
    name: message.name,
    email: message.email,
    phone: message.phone,
    subject: message.subject,
    message: message.message,
    status: message.status,
    createdAt: message.createdAt,
    replies: message.replies.map((reply) => ({
      id: reply.id,
      body: reply.body,
      sentByName: reply.sentBy?.fullName ?? null,
      createdAt: reply.createdAt,
    })),
  };
}
