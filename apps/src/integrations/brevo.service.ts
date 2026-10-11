import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const BREVO_BASE_URL = 'https://api.brevo.com/v3';

/** The transactional emails, named as their Brevo template id is in config. */
export type ChefOnboardingEmail =
  | 'applicationReceived'
  | 'applicationReceivedAdmin'
  | 'documentRejected'
  | 'changesRequested'
  | 'applicationRejected'
  | 'applicationApproved'
  | 'signInLink'
  | 'documentExpiring'
  | 'chefSuspended'
  // FLOW-02: a Lab's Food suggestion a chef adopted changed on a safety field, and
  // an admin took one of the chef's dishes or menus down.
  | 'sourceChanged'
  | 'contentSuspended'
  // Messaging: someone has messages they have not opened.
  | 'newMessage'
  // Contact forms: the heads-up to the team, and the team's answer to the sender.
  | 'contactReceivedAdmin'
  | 'contactReply';

@Injectable()
export class BrevoService {
  private readonly logger = new Logger(BrevoService.name);
  readonly apiKey?: string;
  readonly senderEmail: string;
  readonly senderName: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('brevo.apiKey');
    this.senderEmail = config.get<string>('brevo.senderEmail', 'noreply@labsfood.com');
    this.senderName = config.get<string>('brevo.senderName', 'Labs Food');
    this.templates = config.get('brevo.templates', {});
  }

  /** Brevo template ids per onboarding email (FLOW-01 §2, §5.2, §5.4, §6, §7). */
  readonly templates: Partial<Record<ChefOnboardingEmail, number>>;

  get configured(): boolean {
    return Boolean(this.apiKey);
  }

  get baseUrl(): string {
    return BREVO_BASE_URL;
  }

  /** Build the auth + JSON headers Brevo's REST API expects. */
  buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/json',
    };
    if (this.apiKey) headers['api-key'] = this.apiKey;
    return headers;
  }

  /**
   * Send one Brevo template.
   *
   * Copy lives in Brevo, not here: these emails carry candidate-facing French
   * prose including refusal reasons, and marketing must be able to change the
   * wording without a deploy.
   *
   * Unconfigured (no API key, no template id) is a logged no-op rather than a
   * throw — a missing email must never fail the business operation that triggered
   * it, and local development has no Brevo account.
   */
  async sendTemplate(input: {
    templateId?: number;
    to: { email: string; name?: string };
    params?: Record<string, unknown>;
    /** Where "Reply" goes, when it must not be the sender address. */
    replyTo?: { email: string; name?: string };
    /** Surfaces in the log line and in the audit row. */
    label: string;
  }): Promise<{ sent: boolean; messageId?: string }> {
    if (!this.configured || !input.templateId) {
      this.logger.warn(
        `Email "${input.label}" not sent to ${input.to.email}: ` +
          `${!this.configured ? 'BREVO_API_KEY missing' : 'template id not configured'}.`,
      );
      return { sent: false };
    }

    try {
      const response = await fetch(`${BREVO_BASE_URL}/smtp/email`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          templateId: input.templateId,
          to: [input.to],
          sender: { email: this.senderEmail, name: this.senderName },
          ...(input.replyTo ? { replyTo: input.replyTo } : {}),
          params: input.params ?? {},
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        this.logger.error(
          `Brevo rejected "${input.label}" for ${input.to.email}: ${response.status} ${body}`,
        );
        return { sent: false };
      }

      const payload = (await response.json()) as { messageId?: string };
      this.logger.log(`Email "${input.label}" sent to ${input.to.email}`);
      return { sent: true, messageId: payload.messageId };
    } catch (error) {
      // Brevo being down must not roll back an approval or a document decision.
      this.logger.error(
        `Brevo call failed for "${input.label}" to ${input.to.email}`,
        error instanceof Error ? error.stack : String(error),
      );
      return { sent: false };
    }
  }
}
