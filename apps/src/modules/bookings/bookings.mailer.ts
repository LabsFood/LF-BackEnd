import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BrevoService } from '../../integrations/brevo.service';
import { shortName } from '../messaging/domain/messaging.rules';

const euros = (cents: number) =>
  (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

const firstName = (fullName: string | null | undefined) =>
  fullName?.trim().split(/\s+/)[0] ?? '';

const WHEN = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  dateStyle: 'full',
  timeStyle: 'short',
});

/**
 * The emails of a booking. Best-effort, like every Brevo send: an unset template
 * id or an outage is logged and never undoes what triggered it.
 */
@Injectable()
export class BookingsMailer {
  private readonly site: string;

  constructor(
    private readonly brevo: BrevoService,
    config: ConfigService,
  ) {
    this.site = config
      .get<string>('chefOnboarding.publicSiteUrl', 'https://batchcooking.labsfood.fr')
      .replace(/\/$/, '');
  }

  /** To both, 24 h before an unpaid booking frees its slot. */
  async holdReminder(input: {
    reference: string | null;
    startsAt: Date;
    freedAt: Date;
    amountTtcCents: number;
    client: { email: string; fullName: string | null };
    chef: { email: string; fullName: string | null; displayName: string };
  }) {
    const common = {
      reference: input.reference ?? '',
      when: WHEN.format(input.startsAt),
      freedAt: WHEN.format(input.freedAt),
      amount: euros(input.amountTtcCents),
    };
    await Promise.all([
      this.brevo.sendTemplate({
        templateId: this.brevo.templates.bookingHoldReminderClient,
        to: { email: input.client.email, name: input.client.fullName ?? undefined },
        label: 'booking-hold-reminder-client',
        params: {
          ...common,
          firstName: firstName(input.client.fullName),
          chefName: input.chef.displayName,
          payUrl: `${this.site}/espace-client/commandes`,
        },
      }),
      this.brevo.sendTemplate({
        templateId: this.brevo.templates.bookingHoldReminderChef,
        to: { email: input.chef.email, name: input.chef.fullName ?? undefined },
        label: 'booking-hold-reminder-chef',
        params: {
          ...common,
          firstName: firstName(input.chef.fullName),
          clientName: shortName(input.client.fullName),
          spaceUrl: `${this.site}/espace-chef/prestations`,
        },
      }),
    ]);
  }

  /** To the other side: a new time is proposed for a confirmed prestation. */
  async rescheduleProposed(input: {
    bookingId: string;
    reference: string | null;
    from: Date;
    to: Date;
    expiresAt: Date;
    proposerName: string;
    recipient: { email: string; fullName: string | null; side: 'client' | 'chef' };
  }) {
    await this.brevo.sendTemplate({
      templateId: this.brevo.templates.bookingRescheduleProposed,
      to: { email: input.recipient.email, name: input.recipient.fullName ?? undefined },
      label: `booking-reschedule-proposed-${input.recipient.side}`,
      params: {
        firstName: firstName(input.recipient.fullName),
        reference: input.reference ?? '',
        fromWhen: WHEN.format(input.from),
        toWhen: WHEN.format(input.to),
        expiresAt: WHEN.format(input.expiresAt),
        proposerName: input.proposerName,
        answerUrl: this.spaceUrl(input.recipient.side, input.bookingId),
      },
    });
  }

  /** To the proposer: the other side confirmed or declined the new time. */
  async rescheduleAnswered(input: {
    bookingId: string;
    reference: string | null;
    from: Date;
    to: Date;
    accepted: boolean;
    answererName: string;
    recipient: { email: string; fullName: string | null; side: 'client' | 'chef' };
  }) {
    await this.brevo.sendTemplate({
      templateId: this.brevo.templates.bookingRescheduleAnswered,
      to: { email: input.recipient.email, name: input.recipient.fullName ?? undefined },
      label: `booking-reschedule-answered-${input.recipient.side}`,
      params: {
        firstName: firstName(input.recipient.fullName),
        reference: input.reference ?? '',
        fromWhen: WHEN.format(input.from),
        toWhen: WHEN.format(input.to),
        accepted: input.accepted,
        answererName: input.answererName,
        spaceUrl: this.spaceUrl(input.recipient.side, input.bookingId),
      },
    });
  }

  private spaceUrl(side: 'client' | 'chef', bookingId: string) {
    return side === 'client'
      ? `${this.site}/espace-client/commandes/${bookingId}`
      : `${this.site}/espace-chef/prestations`;
  }
}
