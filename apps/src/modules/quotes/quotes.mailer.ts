import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BrevoService } from '../../integrations/brevo.service';

const euros = (cents: number) =>
  (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

const day = (date: Date) =>
  date.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

const SLOT_LABEL: Record<string, string> = {
  morning: 'matin (9 h – 13 h)',
  afternoon: 'après-midi (14 h – 18 h)',
  evening: 'soir (18 h – 22 h)',
};

const firstName = (fullName: string | null | undefined) =>
  fullName?.trim().split(/\s+/)[0] ?? '';

/**
 * The emails of a custom request.
 *
 * All best-effort (see `BrevoService.sendTemplate`): a provider outage never
 * undoes an offer or an acceptance. Amounts and dates are formatted here, in
 * French, because a Brevo template cannot format a currency.
 */
@Injectable()
export class QuotesMailer {
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
    this.adminEmail = config.get<string>('contact.notificationEmail');
  }

  /** To the batch cooker: a request is waiting for their answer. */
  requestForChef(input: {
    chef: { email: string; fullName: string | null };
    reference: string;
    title: string;
    persons: number;
    city: string | null;
    desiredDate: Date | null;
    timeSlot: string | null;
  }) {
    return this.brevo.sendTemplate({
      templateId: this.brevo.templates.quoteRequestChef,
      to: { email: input.chef.email, name: input.chef.fullName ?? undefined },
      label: 'quote-request-chef',
      params: {
        firstName: firstName(input.chef.fullName),
        reference: input.reference,
        title: input.title,
        persons: input.persons,
        city: input.city ?? '',
        date: input.desiredDate ? day(input.desiredDate) : '',
        slot: input.timeSlot ? (SLOT_LABEL[input.timeSlot] ?? input.timeSlot) : '',
        requestsUrl: `${this.site}/espace-chef/offres`,
      },
    });
  }

  /** To the team: a request has nobody to answer it. */
  needsChef(input: {
    reference: string;
    title: string;
    clientName: string;
    /** `declined`: a batch cooker said no. `unassigned`: the client chose none. */
    why: 'declined' | 'unassigned';
    declineReason?: string | null;
    quoteId: string;
  }) {
    if (!this.adminEmail) return Promise.resolve({ sent: false });
    return this.brevo.sendTemplate({
      templateId: this.brevo.templates.quoteNeedsChefAdmin,
      to: { email: this.adminEmail },
      label: 'quote-needs-chef-admin',
      params: {
        reference: input.reference,
        title: input.title,
        clientName: input.clientName,
        declined: input.why === 'declined',
        declineReason: input.declineReason ?? '',
        requestsUrl: `${this.adminSite}/demandes?d=${input.quoteId}`,
      },
    });
  }

  /** To the client: an offer is waiting for their answer. */
  offerForClient(input: {
    client: { email: string; fullName: string | null };
    chefName: string;
    title: string;
    clientPriceCents: number;
    afterTaxCreditCents: number;
    validUntil: Date;
  }) {
    return this.brevo.sendTemplate({
      templateId: this.brevo.templates.quoteOfferClient,
      to: { email: input.client.email, name: input.client.fullName ?? undefined },
      label: 'quote-offer-client',
      params: {
        firstName: firstName(input.client.fullName),
        chefName: input.chefName,
        title: input.title,
        price: euros(input.clientPriceCents),
        priceAfterTaxCredit: euros(input.afterTaxCreditCents),
        validUntil: day(input.validUntil),
        requestsUrl: `${this.site}/espace-client/personnalisation`,
      },
    });
  }

  /** To the batch cooker: the client said no to their offer. */
  offerDeclinedForChef(input: {
    chef: { email: string; fullName: string | null };
    title: string;
    reason: string | null;
  }) {
    return this.brevo.sendTemplate({
      templateId: this.brevo.templates.quoteOfferDeclinedChef,
      to: { email: input.chef.email, name: input.chef.fullName ?? undefined },
      label: 'quote-offer-declined-chef',
      params: {
        firstName: firstName(input.chef.fullName),
        title: input.title,
        reason: input.reason ?? '',
        requestsUrl: `${this.site}/espace-chef/offres`,
      },
    });
  }

  /** To the client, or to the batch cooker it was with: Lab's Food closed the request. */
  closed(input: {
    to: { email: string; fullName: string | null };
    forChef: boolean;
    reference: string;
    title: string;
  }) {
    return this.brevo.sendTemplate({
      templateId: this.brevo.templates.quoteClosed,
      to: { email: input.to.email, name: input.to.fullName ?? undefined },
      label: input.forChef ? 'quote-closed-chef' : 'quote-closed-client',
      params: {
        firstName: firstName(input.to.fullName),
        reference: input.reference,
        title: input.title,
        forChef: input.forChef,
        requestsUrl: input.forChef
          ? `${this.site}/espace-chef/offres`
          : `${this.site}/espace-client/personnalisation`,
      },
    });
  }

  /**
   * To both, once the client has accepted: the prestation is on. The recap is
   * the confirmation; the invoice comes with the payment, after the prestation.
   */
  async bookingConfirmed(input: {
    client: { email: string; fullName: string | null };
    chef: { email: string; fullName: string | null; displayName: string };
    bookingReference: string | null;
    title: string;
    date: Date;
    timeSlot: string;
    address: string;
    persons: number;
    clientPriceCents: number;
    afterTaxCreditCents: number;
    netCents: number;
    conditions: string | null;
  }) {
    const common = {
      reference: input.bookingReference ?? '',
      title: input.title,
      date: day(input.date),
      slot: SLOT_LABEL[input.timeSlot] ?? input.timeSlot,
      address: input.address,
      persons: input.persons,
      conditions: input.conditions ?? '',
    };
    await Promise.all([
      this.brevo.sendTemplate({
        templateId: this.brevo.templates.bookingConfirmed,
        to: { email: input.client.email, name: input.client.fullName ?? undefined },
        label: 'booking-confirmed-client',
        params: {
          ...common,
          firstName: firstName(input.client.fullName),
          forChef: false,
          counterpartName: input.chef.displayName,
          price: euros(input.clientPriceCents),
          priceAfterTaxCredit: euros(input.afterTaxCreditCents),
          spaceUrl: `${this.site}/espace-client/commandes`,
        },
      }),
      this.brevo.sendTemplate({
        templateId: this.brevo.templates.bookingConfirmed,
        to: { email: input.chef.email, name: input.chef.fullName ?? undefined },
        label: 'booking-confirmed-chef',
        params: {
          ...common,
          firstName: firstName(input.chef.fullName),
          forChef: true,
          counterpartName: input.client.fullName ?? 'votre client',
          // The batch cooker reads what they earn, not what the client pays.
          price: euros(input.netCents),
          priceAfterTaxCredit: '',
          spaceUrl: `${this.site}/espace-chef/prestations`,
        },
      }),
    ]);
  }
}
