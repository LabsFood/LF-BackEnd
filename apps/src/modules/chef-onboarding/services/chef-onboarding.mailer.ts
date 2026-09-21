import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BrevoService } from '../../../integrations/brevo.service';

/**
 * The FLOW-01 transactional emails.
 *
 * Every send is best-effort (see `BrevoService.sendTemplate`): an email provider
 * outage must never roll back an approval or a document decision. Copy lives in
 * Brevo templates, so the only thing passed from here is data.
 */
@Injectable()
export class ChefOnboardingMailer {
  private readonly publicSiteUrl: string;
  private readonly adminEmail?: string;

  constructor(
    private readonly brevo: BrevoService,
    config: ConfigService,
  ) {
    this.publicSiteUrl = config
      .get<string>('chefOnboarding.publicSiteUrl', 'https://labsfood.fr')
      .replace(/\/$/, '');
    this.adminEmail = config.get<string>('chefOnboarding.adminNotificationEmail');
  }

  /** The link a candidate follows to complete their dossier (FLOW-01 §2). */
  completionUrl(applicationId: string, token: string): string {
    return `${this.publicSiteUrl}/candidature/${applicationId}/documents?token=${token}`;
  }

  applicationReceived(input: {
    email: string;
    firstName: string;
    reference: string;
    applicationId: string;
    token: string;
  }) {
    return this.brevo.sendTemplate({
      templateId: this.brevo.templates.applicationReceived,
      to: { email: input.email, name: input.firstName },
      label: 'application-received',
      params: {
        firstName: input.firstName,
        reference: input.reference,
        completionUrl: this.completionUrl(input.applicationId, input.token),
        expiresInDays: 30,
      },
    });
  }

  /** Internal heads-up so the review queue is not a page someone must remember. */
  applicationReceivedAdmin(input: {
    reference: string;
    applicationId: string;
    name: string;
    city: string;
  }) {
    if (!this.adminEmail) return Promise.resolve({ sent: false });
    return this.brevo.sendTemplate({
      templateId: this.brevo.templates.applicationReceivedAdmin,
      to: { email: this.adminEmail },
      label: 'application-received-admin',
      params: {
        ...input,
        adminUrl: `${this.publicSiteUrl}/batchcookers/${input.applicationId}`,
      },
    });
  }

  documentRejected(input: {
    email: string;
    firstName: string;
    documentLabel: string;
    reason: string;
    applicationId: string;
    token: string | null;
  }) {
    return this.brevo.sendTemplate({
      templateId: this.brevo.templates.documentRejected,
      to: { email: input.email, name: input.firstName },
      label: 'document-rejected',
      params: {
        firstName: input.firstName,
        documentLabel: input.documentLabel,
        reason: input.reason,
        completionUrl: input.token
          ? this.completionUrl(input.applicationId, input.token)
          : `${this.publicSiteUrl}/espace-chef/dossier`,
      },
    });
  }

  changesRequested(input: {
    email: string;
    firstName: string;
    message: string;
    documentLabels: string[];
    applicationId: string;
    token: string;
  }) {
    return this.brevo.sendTemplate({
      templateId: this.brevo.templates.changesRequested,
      to: { email: input.email, name: input.firstName },
      label: 'changes-requested',
      params: {
        firstName: input.firstName,
        message: input.message,
        documentLabels: input.documentLabels,
        completionUrl: this.completionUrl(input.applicationId, input.token),
      },
    });
  }

  applicationRejected(input: {
    email: string;
    firstName: string;
    reason: string;
    allowReapplyAfter?: string | null;
  }) {
    return this.brevo.sendTemplate({
      templateId: this.brevo.templates.applicationRejected,
      to: { email: input.email, name: input.firstName },
      label: 'application-rejected',
      params: {
        firstName: input.firstName,
        reason: input.reason,
        allowReapplyAfter: input.allowReapplyAfter ?? null,
      },
    });
  }

  /** First-login link issued at approval (FLOW-01 §6). */
  welcomeMagicLink(input: {
    email: string;
    firstName: string;
    signInUrl: string;
    expiresAt: Date;
  }) {
    return this.brevo.sendTemplate({
      templateId: this.brevo.templates.welcomeMagicLink,
      to: { email: input.email, name: input.firstName },
      label: 'welcome-magic-link',
      params: {
        firstName: input.firstName,
        signInUrl: input.signInUrl,
        expiresAt: input.expiresAt.toISOString(),
      },
    });
  }

  documentExpiring(input: {
    email: string;
    firstName: string;
    documentLabel: string;
    expiresOn: string;
    daysLeft: number;
  }) {
    return this.brevo.sendTemplate({
      templateId: this.brevo.templates.documentExpiring,
      to: { email: input.email, name: input.firstName },
      label: `document-expiring-j${input.daysLeft}`,
      params: {
        firstName: input.firstName,
        documentLabel: input.documentLabel,
        expiresOn: input.expiresOn,
        daysLeft: input.daysLeft,
        dossierUrl: `${this.publicSiteUrl}/espace-chef/dossier`,
      },
    });
  }

  /**
   * The only time the platform takes a storefront offline without a human
   * decision, so the email has to say plainly what happened and how to undo it.
   */
  chefSuspended(input: { email: string; firstName: string; documentLabel: string }) {
    return this.brevo.sendTemplate({
      templateId: this.brevo.templates.chefSuspended,
      to: { email: input.email, name: input.firstName },
      label: 'chef-suspended',
      params: {
        firstName: input.firstName,
        documentLabel: input.documentLabel,
        dossierUrl: `${this.publicSiteUrl}/espace-chef/dossier`,
      },
    });
  }
}
