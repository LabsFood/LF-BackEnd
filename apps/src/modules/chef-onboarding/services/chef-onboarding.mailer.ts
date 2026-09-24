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

  /** Where a signed-in candidate or chef manages their documents. */
  private get dossierUrl(): string {
    return `${this.publicSiteUrl}/espace-chef/dossier`;
  }

  /**
   * Acknowledgement plus the only way into the new account: a single-use sign-in
   * link, sent to the address that was submitted and nowhere else (FLOW-01 §2).
   */
  applicationReceived(input: {
    email: string;
    firstName: string;
    reference: string;
    signInUrl: string;
    expiresAt: Date;
  }) {
    return this.brevo.sendTemplate({
      templateId: this.brevo.templates.applicationReceived,
      to: { email: input.email, name: input.firstName },
      label: 'application-received',
      params: {
        firstName: input.firstName,
        reference: input.reference,
        signInUrl: input.signInUrl,
        expiresAt: input.expiresAt.toISOString(),
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
  }) {
    return this.brevo.sendTemplate({
      templateId: this.brevo.templates.documentRejected,
      to: { email: input.email, name: input.firstName },
      label: 'document-rejected',
      params: {
        firstName: input.firstName,
        documentLabel: input.documentLabel,
        reason: input.reason,
        dossierUrl: this.dossierUrl,
      },
    });
  }

  changesRequested(input: {
    email: string;
    firstName: string;
    message: string;
    documentLabels: string[];
  }) {
    return this.brevo.sendTemplate({
      templateId: this.brevo.templates.changesRequested,
      to: { email: input.email, name: input.firstName },
      label: 'changes-requested',
      params: {
        firstName: input.firstName,
        message: input.message,
        documentLabels: input.documentLabels,
        dossierUrl: this.dossierUrl,
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

  /** The candidature is approved: the account is now a verified batch cooker. */
  applicationApproved(input: { email: string; firstName: string }) {
    return this.brevo.sendTemplate({
      templateId: this.brevo.templates.applicationApproved,
      to: { email: input.email, name: input.firstName },
      label: 'application-approved',
      params: {
        firstName: input.firstName,
        dashboardUrl: `${this.publicSiteUrl}/espace-chef`,
      },
    });
  }

  /** A fresh sign-in link, re-sent by an admin when the first one expired unused. */
  signInLink(input: {
    email: string;
    firstName: string;
    signInUrl: string;
    expiresAt: Date;
  }) {
    return this.brevo.sendTemplate({
      templateId: this.brevo.templates.signInLink,
      to: { email: input.email, name: input.firstName },
      label: 'sign-in-link',
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
        dossierUrl: this.dossierUrl,
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
        dossierUrl: this.dossierUrl,
      },
    });
  }
}
