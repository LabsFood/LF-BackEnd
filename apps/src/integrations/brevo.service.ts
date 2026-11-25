import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const BREVO_BASE_URL = 'https://api.brevo.com/v3';
/** Startup must not hang on Brevo: past this, the ids from the env alone are used. */
const LOOKUP_TIMEOUT_MS = 10_000;

/**
 * `BREVO_TPL_BOOKING_REQUEST_CHEF` → `bookingRequestChef`: the repo names each Brevo
 * template after the env var of its id (`brevo/templates/`), and the config key is that
 * name in camelCase. Null for a template the repo did not create.
 */
export function templateKeyOf(name: string): string | null {
  const match = /^BREVO_TPL_([A-Z0-9_]+)$/.exec(name);
  if (!match) return null;
  return match[1]
    .toLowerCase()
    .replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

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
  // Recettes §5.5: a common-list change cleared the verification of a chef's
  // dishes (§7.3); a chef's recipes moved to the new form (§9).
  | 'recipeAllergensChanged'
  | 'recipesMigrated'
  // Messaging: someone has messages they have not opened.
  | 'newMessage'
  // Contact forms: the heads-up to the team, and the team's answer to the sender.
  | 'contactReceivedAdmin'
  | 'contactReply'
  // Custom requests: each step that hands the request to someone else.
  | 'quoteRequestChef'
  | 'quoteNeedsChefAdmin'
  | 'quoteOfferClient'
  | 'quoteOfferDeclinedChef'
  | 'quoteClosed'
  | 'bookingConfirmed'
  // Bookings: an unpaid booking's slot is freed in 24 h.
  | 'bookingHoldReminderClient'
  | 'bookingHoldReminderChef'
  | 'bookingRescheduleProposed'
  | 'bookingRescheduleAnswered'
  // CGV V1: the contract on a durable medium, and an online withdrawal's
  // acknowledgement and heads-up to the team.
  | 'bookingContractClient'
  | 'bookingWithdrawalAck'
  | 'bookingWithdrawalAdmin'
  // CGV V1 direct booking (decision of 2026-11-19): the request to the batch cooker,
  // its refusal or expiry, the charge after the session refused, the CESU reminder.
  | 'bookingRequestChef'
  | 'bookingRequestDeclined'
  | 'bookingChargeFailed'
  | 'bookingCesuReminder'
  // Recettes lot 6, art. 8: the message before the groceries (the one double-channel
  // signal of the module), its delivery confirmed by the Brevo webhook.
  | 'groceriesNotice'
  // Budget IA: AI spending crossed its alert threshold or its cap.
  | 'aiBudgetAlert';

@Injectable()
export class BrevoService implements OnModuleInit {
  private readonly logger = new Logger(BrevoService.name);
  readonly apiKey?: string;
  readonly senderEmail: string;
  readonly senderName: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('brevo.apiKey');
    this.senderEmail = config.get<string>('brevo.senderEmail', 'noreply@labsfood.com');
    this.senderName = config.get<string>('brevo.senderName', 'Labs Food');
    // A copy: the lookup fills it in place, never the config object.
    this.templates = { ...config.get('brevo.templates', {}) };
  }

  /**
   * Brevo template ids per email. Found by name at startup (`onModuleInit`); a
   * `BREVO_TPL_*` env var, when set, wins over the lookup.
   */
  readonly templates: Partial<Record<ChefOnboardingEmail, number>>;

  /**
   * Reads the account's templates once and fills every id the env left unset, so a
   * template `brevo/upload.mjs` created at deploy is used without a Railway variable.
   * Best-effort: Brevo down or slow, the API starts with the env ids alone.
   */
  async onModuleInit(): Promise<void> {
    if (!this.configured) return;
    try {
      const response = await fetch(`${BREVO_BASE_URL}/smtp/templates?limit=1000`, {
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn({
          event: 'brevo.template_lookup_failed',
          status: response.status,
        });
        return;
      }
      const { templates = [] } = (await response.json()) as {
        templates?: { id: number; name: string }[];
      };
      const found: string[] = [];
      const ids = this.templates as Record<string, number | undefined>;
      for (const template of templates) {
        const key = templateKeyOf(template.name);
        if (!key || ids[key]) continue;
        ids[key] = template.id;
        found.push(key);
      }
      this.logger.log({ event: 'brevo.templates_resolved', byName: found.length });
    } catch (error) {
      this.logger.warn({
        event: 'brevo.template_lookup_failed',
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

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
    /** Files sent with it, base64. The contract documents (CGV art. 2.4). */
    attachment?: { name: string; content: string }[];
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
          ...(input.attachment?.length ? { attachment: input.attachment } : {}),
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
