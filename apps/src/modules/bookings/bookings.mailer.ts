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

const DAY = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  dateStyle: 'full',
});

/** An amount, or '' when there is none: the templates test emptiness. */
const amountOrEmpty = (cents: number | null) => (cents ? euros(cents) : '');

/** A file attached to an email: its name and its bytes. */
export interface MailFile {
  name: string;
  bytes: Buffer;
}

/**
 * The emails of a booking. Best-effort, like every Brevo send: an unset template
 * id or an outage is logged and never undoes what triggered it.
 */
@Injectable()
export class BookingsMailer {
  private readonly site: string;

  private readonly adminSite: string;
  private readonly adminEmail?: string;

  constructor(
    private readonly brevo: BrevoService,
    config: ConfigService,
  ) {
    this.site = config
      .get<string>('chefOnboarding.publicSiteUrl', 'https://batchcooking.labsfood.fr')
      .replace(/\/$/, '');
    this.adminSite = config
      .get<string>('contact.adminSiteUrl', 'https://admin.labsfood.fr')
      .replace(/\/$/, '');
    this.adminEmail = config.get<string>('contact.notificationEmail') || undefined;
  }

  /**
   * To the client, once the contract is concluded: its recap on a durable medium,
   * with the CGV and the withdrawal form attached (CGV art. 2.4, 5.2).
   */
  async contractClient(input: {
    bookingId: string;
    reference: string | null;
    client: { email: string; fullName: string | null };
    title: string;
    startsAt: Date;
    slot: string | null;
    address: string | null;
    persons: number | null;
    priceCents: number;
    conditions: string | null;
    chefName: string;
    /** The legal identity, one line per item (CGV art. 3.2). */
    chefIdentity: string;
    withdrawalUntil: Date;
    earlyExecution: boolean;
    files: MailFile[];
  }) {
    return this.brevo.sendTemplate({
      templateId: this.brevo.templates.bookingContractClient,
      to: { email: input.client.email, name: input.client.fullName ?? undefined },
      label: 'booking-contract-client',
      params: {
        firstName: firstName(input.client.fullName),
        reference: input.reference ?? '',
        title: input.title,
        date: DAY.format(input.startsAt),
        slot: input.slot ?? '',
        address: input.address ?? '',
        persons: input.persons ?? '',
        price: euros(input.priceCents),
        conditions: input.conditions ?? '',
        chefName: input.chefName,
        chefIdentity: input.chefIdentity,
        withdrawalUntil: DAY.format(input.withdrawalUntil),
        earlyExecution: input.earlyExecution,
        spaceUrl: this.spaceUrl('client', input.bookingId),
      },
      attachment: input.files.map((file) => ({
        name: file.name,
        content: file.bytes.toString('base64'),
      })),
    });
  }

  /** To the client: the acknowledgement of an online withdrawal (CGV art. 15.2). */
  async withdrawalAck(input: {
    bookingId: string;
    reference: string | null;
    client: { email: string; fullName: string | null };
    chefName: string;
    submittedAt: Date;
    declaration: string;
    dueCents: number | null;
    refundCents: number | null;
  }) {
    return this.brevo.sendTemplate({
      templateId: this.brevo.templates.bookingWithdrawalAck,
      to: { email: input.client.email, name: input.client.fullName ?? undefined },
      label: 'booking-withdrawal-ack',
      params: {
        firstName: firstName(input.client.fullName),
        reference: input.reference ?? '',
        chefName: input.chefName,
        submittedAt: WHEN.format(input.submittedAt),
        declaration: input.declaration,
        shareUnknown: input.dueCents === null,
        dueAmount: amountOrEmpty(input.dueCents),
        refundAmount: amountOrEmpty(input.refundCents),
        spaceUrl: this.spaceUrl('client', input.bookingId),
      },
    });
  }

  /** To the team: a withdrawal to refund by hand before `deadline` (CGV art. 15.5). */
  async withdrawalAdmin(input: {
    bookingId: string;
    reference: string | null;
    status: string;
    paidCents: number;
    dueCents: number | null;
    refundCents: number | null;
    methods: string[];
    deadline: Date;
  }) {
    if (!this.adminEmail) return { sent: false };
    return this.brevo.sendTemplate({
      templateId: this.brevo.templates.bookingWithdrawalAdmin,
      to: { email: this.adminEmail },
      label: 'booking-withdrawal-admin',
      params: {
        reference: input.reference ?? input.bookingId,
        status: input.status,
        paidAmount: euros(input.paidCents),
        shareUnknown: input.dueCents === null,
        dueAmount: euros(input.dueCents ?? 0),
        refundAmount: euros(input.refundCents ?? 0),
        methods: input.methods.join(', '),
        deadline: DAY.format(input.deadline),
        adminUrl: `${this.adminSite}/reservations/${input.bookingId}`,
      },
    });
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

  /**
   * CGV V1 5.2: to the batch cooker, a request to accept or refuse before `acceptBy`;
   * sent again halfway through the delay.
   */
  async requestChef(input: {
    bookingId: string;
    reference: string | null;
    startsAt: Date;
    acceptBy: Date;
    amountTtcCents: number;
    clientName: string | null;
    chef: { email: string; fullName: string | null };
  }) {
    await this.brevo.sendTemplate({
      templateId: this.brevo.templates.bookingRequestChef,
      to: { email: input.chef.email, name: input.chef.fullName ?? undefined },
      label: 'booking-request-chef',
      params: {
        firstName: firstName(input.chef.fullName),
        reference: input.reference ?? '',
        when: WHEN.format(input.startsAt),
        acceptBy: WHEN.format(input.acceptBy),
        amount: euros(input.amountTtcCents),
        clientName: shortName(input.clientName),
        spaceUrl: this.spaceUrl('chef', input.bookingId),
      },
    });
  }

  /** To the client: the batch cooker refused, or let the 48 h pass. Nothing charged. */
  async requestDeclined(input: {
    reference: string | null;
    startsAt: Date;
    client: { email: string; fullName: string | null };
    chefName: string;
    reason: string | null;
    expired: boolean;
  }) {
    await this.brevo.sendTemplate({
      templateId: this.brevo.templates.bookingRequestDeclined,
      to: { email: input.client.email, name: input.client.fullName ?? undefined },
      label: 'booking-request-declined',
      params: {
        firstName: firstName(input.client.fullName),
        reference: input.reference ?? '',
        when: WHEN.format(input.startsAt),
        chefName: input.chefName,
        reason: input.reason ?? '',
        expired: input.expired,
        searchUrl: `${this.site}/chefs`,
      },
    });
  }

  /** CGV 7.5: the charge after the session was refused; 48 h to settle it. */
  async chargeFailed(input: {
    bookingId: string;
    reference: string | null;
    startsAt: Date;
    amountCents: number;
    client: { email: string; fullName: string | null };
    chefName: string;
  }) {
    await this.brevo.sendTemplate({
      templateId: this.brevo.templates.bookingChargeFailed,
      to: { email: input.client.email, name: input.client.fullName ?? undefined },
      label: 'booking-charge-failed',
      params: {
        firstName: firstName(input.client.fullName),
        reference: input.reference ?? '',
        when: WHEN.format(input.startsAt),
        amount: euros(input.amountCents),
        chefName: input.chefName,
        payUrl: this.spaceUrl('client', input.bookingId),
      },
    });
  }

  /** The session is over and the client chose CESU: declare the titles within 48 h. */
  async cesuReminder(input: {
    bookingId: string;
    reference: string | null;
    startsAt: Date;
    amountCents: number;
    client: { email: string; fullName: string | null };
    chefName: string;
  }) {
    await this.brevo.sendTemplate({
      templateId: this.brevo.templates.bookingCesuReminder,
      to: { email: input.client.email, name: input.client.fullName ?? undefined },
      label: 'booking-cesu-reminder',
      params: {
        firstName: firstName(input.client.fullName),
        reference: input.reference ?? '',
        when: WHEN.format(input.startsAt),
        amount: euros(input.amountCents),
        chefName: input.chefName,
        payUrl: this.spaceUrl('client', input.bookingId),
      },
    });
  }

  private spaceUrl(side: 'client' | 'chef', bookingId: string) {
    return side === 'client'
      ? `${this.site}/espace-client/commandes/${bookingId}`
      : `${this.site}/espace-chef/prestations`;
  }
}
