import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Stripe from 'stripe';

import { ChefDocumentType } from '../../generated/prisma/client';
import { StripeService } from '../../integrations/stripe.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ChefDocumentsService } from '../chef-onboarding/services/chef-documents.service';
import { UsersService } from '../users/users.service';
import { CommissionDebitsService } from './commission-debits.service';
import {
  SepaMandateCheckoutDto,
  SepaMandateSetupIntentDto,
  SepaMandateStatusDto,
} from './dto/stripe-connect.dto';
import { assertOwnSiteUrl } from './own-site-url';
import { renderMandatePdf } from './sepa-mandate-document';
import {
  addCustomerConfiguration,
  customerAccountOptions,
  customerRef,
  paymentMethodTypes,
  stripeErrorFields,
} from './stripe-accounts-v2';

/** The creditor named on the mandate and on every debit (facture B is in this name). */
const CREDITOR_NAME = "LAB'S FOOD";

/**
 * The SEPA mandate that lets Lab's Food debit its commission from the chef's IBAN.
 *
 * Card payments do not need it: Stripe withholds their commission at charge time. CESU
 * and the immediate advance do — the client's money never crosses Stripe — which is why
 * neither is offered without an active mandate (`mandateActive`, chef-cesu-info.ts).
 *
 * Stripe's `sepa_debit` is the SEPA **CORE** scheme (B2B is not exposed by the API): the
 * chef can have any debit refunded for eight weeks, which `commission-standing.ts` caps.
 *
 * The IBAN never reaches this backend. The chef signs on a Stripe Checkout page in
 * `setup` mode, which collects the IBAN, shows the mandate text and records the
 * acceptance; the backend only ever stores the IBAN's last four characters.
 */
@Injectable()
export class SepaMandatesService {
  private readonly logger = new Logger(SepaMandatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
    private readonly documents: ChefDocumentsService,
    private readonly commissionDebits: CommissionDebitsService,
  ) {}

  /**
   * `POST /me/chef-profile/sepa-mandate/checkout` — the hosted page where the chef signs.
   *
   * Stripe sends the chef back to `returnUrl` with `?mandat=signe&session_id=…`, which
   * the page passes to `confirmCheckout`; `setup_intent.succeeded` does the same work if
   * it lands first. An already active mandate stays in force until the new one is signed,
   * so a chef changing bank account is never left without one.
   */
  async createCheckoutSession(
    clerkUserId: string,
    returnUrl: string,
  ): Promise<SepaMandateCheckoutDto> {
    this.assertStripeConfigured();
    assertOwnSiteUrl(
      this.config,
      returnUrl,
      'returnUrl must point at a Lab’s Food site.',
    );
    const chef = await this.requireChefProfile(clerkUserId);
    const stripe = this.stripe.getClient();

    const existing = await this.prisma.sepaMandate.findUnique({
      where: { chefProfileId: chef.chefProfileId },
    });
    const customerId = await this.resolveCustomer(
      chef,
      existing?.stripeCustomerId ?? null,
    );

    const back = new URL(returnUrl);
    back.searchParams.set('mandat', 'signe');
    const cancel = new URL(returnUrl);
    cancel.searchParams.set('mandat', 'annule');
    const params = {
      mode: 'setup',
      currency: 'eur',
      ...paymentMethodTypes(customerId, ['sepa_debit']),
      ...customerRef(customerId),
      locale: 'fr',
      // Both carry the chef: the session for `confirmCheckout`, the SetupIntent for the
      // webhook, which never sees the session.
      metadata: { chefProfileId: chef.chefProfileId },
      setup_intent_data: { metadata: { chefProfileId: chef.chefProfileId } },
      // `{CHECKOUT_SESSION_ID}` is Stripe's placeholder: appended raw, never encoded.
      success_url: `${back.toString()}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancel.toString(),
    } as Stripe.Checkout.SessionCreateParams;

    let session: Stripe.Checkout.Session;
    try {
      session = customerId.startsWith('acct_')
        ? await stripe.checkout.sessions.create(params, customerAccountOptions)
        : await stripe.checkout.sessions.create(params);
    } catch (error) {
      throw this.stripeFailure('checkout_create', chef.chefProfileId, error);
    }

    if (existing?.status !== 'active') {
      await this.prisma.sepaMandate.upsert({
        where: { chefProfileId: chef.chefProfileId },
        update: { stripeCustomerId: customerId, status: 'pending' },
        create: {
          chefProfileId: chef.chefProfileId,
          stripeCustomerId: customerId,
          status: 'pending',
        },
      });
    }

    this.logger.log({
      event: 'sepa.checkout_created',
      chefProfileId: chef.chefProfileId,
      resigning: existing?.status === 'active',
    });
    return { url: session.url ?? '' };
  }

  /**
   * `POST /me/chef-profile/sepa-mandate/confirm` — called by the return page with the
   * Checkout session id, so the mandate is active the moment the chef is back, whether
   * or not the webhook has arrived. A session that is not this chef's is a 404, the
   * same answer as one that does not exist.
   */
  async confirmCheckout(
    clerkUserId: string,
    sessionId: string,
  ): Promise<SepaMandateStatusDto> {
    this.assertStripeConfigured();
    const chef = await this.requireChefProfile(clerkUserId);
    const stripe = this.stripe.getClient();

    let session: Stripe.Checkout.Session | null = null;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['setup_intent'],
      });
    } catch {
      session = null;
    }
    if (!session || session.metadata?.chefProfileId !== chef.chefProfileId) {
      throw new NotFoundException({
        code: 'MANDATE_SESSION_NOT_FOUND',
        message: 'No mandate signature found for this session.',
      });
    }
    if (session.status !== 'complete' || !session.setup_intent) {
      throw new ConflictException({
        code: 'MANDATE_NOT_SIGNED',
        message: 'The mandate was not signed on the Stripe page.',
      });
    }

    const setupIntent =
      typeof session.setup_intent === 'string'
        ? await stripe.setupIntents.retrieve(session.setup_intent)
        : session.setup_intent;
    await this.activate(chef.chefProfileId, setupIntent);

    return (await this.statusOf(chef.chefProfileId))!;
  }

  /**
   * `setup_intent.succeeded`. Finds the row by SetupIntent, else by the chef the
   * Checkout session tagged it with — a Checkout SetupIntent is only created when the
   * chef submits the page, so its id is unknown until then.
   */
  async handleSetupIntentSucceeded(setupIntent: Stripe.SetupIntent): Promise<void> {
    const byIntent = await this.prisma.sepaMandate.findFirst({
      where: { stripeSetupIntentId: setupIntent.id },
      select: { chefProfileId: true },
    });
    const chefProfileId = byIntent?.chefProfileId ?? setupIntent.metadata?.chefProfileId;
    if (!chefProfileId) {
      this.logger.warn({
        event: 'sepa.setup_intent_unknown',
        setupIntentId: setupIntent.id,
      });
      return;
    }
    await this.activate(chefProfileId, setupIntent);
  }

  /**
   * @deprecated Stripe Elements flow, kept until the chef page uses `createCheckoutSession`.
   * The frontend never confirmed these, which is how mandates stayed `pending` forever.
   */
  async createSetupIntent(clerkUserId: string): Promise<SepaMandateSetupIntentDto> {
    this.assertStripeConfigured();
    const chef = await this.requireChefProfile(clerkUserId);
    const stripe = this.stripe.getClient();

    const existing = await this.prisma.sepaMandate.findUnique({
      where: { chefProfileId: chef.chefProfileId },
    });
    const customerId = await this.resolveCustomer(
      chef,
      existing?.stripeCustomerId ?? null,
    );

    const params = {
      ...customerRef(customerId),
      ...paymentMethodTypes(customerId, ['sepa_debit']),
      usage: 'off_session',
      metadata: { chefProfileId: chef.chefProfileId },
    } as Stripe.SetupIntentCreateParams;
    const setupIntent = customerId.startsWith('acct_')
      ? await stripe.setupIntents.create(params, customerAccountOptions)
      : await stripe.setupIntents.create(params);

    const fields = {
      stripeCustomerId: customerId,
      stripeSetupIntentId: setupIntent.id,
      status: 'pending' as const,
    };
    await this.prisma.sepaMandate.upsert({
      where: { chefProfileId: chef.chefProfileId },
      update: fields,
      create: { chefProfileId: chef.chefProfileId, ...fields },
    });

    return { clientSecret: setupIntent.client_secret ?? '' };
  }

  async getStatus(clerkUserId: string): Promise<SepaMandateStatusDto | null> {
    const { chefProfileId } = await this.requireChefProfile(clerkUserId);
    return this.statusOf(chefProfileId);
  }

  /**
   * The one place a mandate becomes active, from the return page or the webhook. The
   * conditional update is the claim: when both arrive together, only one of them files
   * the document and starts the debits.
   */
  private async activate(chefProfileId: string, setupIntent: Stripe.SetupIntent) {
    if (setupIntent.status !== 'succeeded') {
      throw new ConflictException({
        code: 'MANDATE_NOT_SIGNED',
        message: `The mandate signature is ${setupIntent.status} at Stripe.`,
      });
    }
    const row = await this.prisma.sepaMandate.findUnique({ where: { chefProfileId } });
    if (!row) {
      this.logger.warn({ event: 'sepa.activation_without_row', chefProfileId });
      return;
    }
    if (row.status === 'active' && row.stripeSetupIntentId === setupIntent.id) {
      return;
    }

    const stripe = this.stripe.getClient();
    const paymentMethodId = idOf(setupIntent.payment_method);
    const stripeMandateId = idOf(setupIntent.mandate);
    if (!paymentMethodId || !stripeMandateId) {
      throw new ConflictException({
        code: 'MANDATE_INCOMPLETE',
        message: 'Stripe returned no payment method or mandate for this signature.',
      });
    }

    let paymentMethod: Stripe.PaymentMethod;
    let mandate: Stripe.Mandate;
    try {
      [paymentMethod, mandate] = await Promise.all([
        typeof setupIntent.payment_method === 'object' && setupIntent.payment_method
          ? setupIntent.payment_method
          : stripe.paymentMethods.retrieve(paymentMethodId),
        stripe.mandates.retrieve(stripeMandateId),
      ]);
    } catch (error) {
      throw this.stripeFailure('mandate_read', chefProfileId, error);
    }

    const acceptedAt = mandate.customer_acceptance?.accepted_at;
    const signedAt = acceptedAt ? new Date(acceptedAt * 1000) : new Date();
    const ibanLast4 = paymentMethod.sepa_debit?.last4 ?? null;

    // Only a later signature replaces the active one. Stripe retries each event on its own
    // schedule, so the webhook of an older attempt can land after a newer signature: it
    // must not bring the old mandate back, nor file a second copy of it.
    const claimed = await this.prisma.sepaMandate.updateMany({
      where: {
        id: row.id,
        OR: [
          { status: { not: 'active' } },
          { signedAt: null },
          { signedAt: { lt: signedAt } },
        ],
      },
      data: {
        status: 'active',
        stripeSetupIntentId: setupIntent.id,
        stripePaymentMethodId: paymentMethodId,
        stripeMandateId,
        ibanLast4,
        signedAt,
      },
    });
    if (claimed.count === 0) {
      return;
    }
    this.logger.log({
      event: 'sepa.mandate_active',
      chefProfileId,
      mandateRowId: row.id,
    });

    await this.archive(chefProfileId, mandate, paymentMethod, { ibanLast4, signedAt });
    await this.commissionDebits.collectOutstanding(chefProfileId);
  }

  /**
   * Files the signed mandate in the chef's dossier. A storage failure is logged, not
   * thrown: the mandate is valid at Stripe either way, and refusing the activation over
   * our own copy would block every debit.
   */
  private async archive(
    chefProfileId: string,
    mandate: Stripe.Mandate,
    paymentMethod: Stripe.PaymentMethod,
    facts: { ibanLast4: string | null; signedAt: Date },
  ) {
    const reference = mandate.payment_method_details?.sepa_debit?.reference ?? mandate.id;
    const online = mandate.customer_acceptance?.online;
    try {
      const chef = await this.prisma.chefProfile.findUniqueOrThrow({
        where: { id: chefProfileId },
        select: { displayName: true, user: { select: { email: true } } },
      });
      const pdf = await renderMandatePdf({
        reference,
        stripeMandateId: mandate.id,
        creditorName: CREDITOR_NAME,
        debtorName: paymentMethod.billing_details?.name ?? chef.displayName,
        debtorEmail: paymentMethod.billing_details?.email ?? chef.user.email,
        ibanLast4: facts.ibanLast4,
        signedAt: facts.signedAt,
        acceptance: online
          ? { ipAddress: online.ip_address, userAgent: online.user_agent }
          : null,
      });
      await this.documents.recordSystemDocument(
        chefProfileId,
        ChefDocumentType.sepa_mandate,
        {
          bytes: pdf,
          fileName: `mandat-sepa-${reference}.pdf`,
          mimeType: 'application/pdf',
        },
        { stripeMandateId: mandate.id },
      );
    } catch (error) {
      this.logger.error({
        event: 'sepa.archive_failed',
        chefProfileId,
        stripeMandateId: mandate.id,
        reason: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }

  /**
   * The chef's own connected account is the customer once they have one (Accounts v2),
   * so the mandate and the payouts sit on the same object. A `cus_…` already on the row
   * keeps being used; a chef who has not started Stripe onboarding yet still gets one.
   */
  private async resolveCustomer(
    chef: Awaited<ReturnType<SepaMandatesService['requireChefProfile']>>,
    known: string | null,
  ): Promise<string> {
    if (known) return known;
    const stripe = this.stripe.getClient();
    if (chef.stripeAccountId) {
      await addCustomerConfiguration(stripe, chef.stripeAccountId);
      return chef.stripeAccountId;
    }
    try {
      const customer = await stripe.customers.create({
        email: chef.email,
        name: chef.displayName,
        metadata: { chefProfileId: chef.chefProfileId },
      });
      return customer.id;
    } catch (error) {
      throw this.stripeFailure('customer_create', chef.chefProfileId, error);
    }
  }

  private async statusOf(chefProfileId: string): Promise<SepaMandateStatusDto | null> {
    const mandate = await this.prisma.sepaMandate.findUnique({
      where: { chefProfileId },
    });
    if (!mandate) {
      return null;
    }
    return {
      status: mandate.status,
      ibanLast4: mandate.ibanLast4,
      signedAt: mandate.signedAt,
    };
  }

  /** Never Stripe's message: it can echo the chef's e-mail or IBAN. */
  private stripeFailure(step: string, chefProfileId: string, error: unknown) {
    this.logger.error({
      event: 'sepa.stripe_failed',
      step,
      chefProfileId,
      ...stripeErrorFields(error),
    });
    return new ServiceUnavailableException({
      code: 'STRIPE_UNAVAILABLE',
      message: 'Stripe could not complete the mandate step. Try again in a moment.',
    });
  }

  private assertStripeConfigured(): void {
    if (!this.stripe.configured) {
      throw new ServiceUnavailableException(
        'Stripe is not configured (STRIPE_SECRET_KEY missing).',
      );
    }
  }

  private async requireChefProfile(clerkUserId: string): Promise<{
    chefProfileId: string;
    displayName: string;
    email: string;
    stripeAccountId: string | null;
  }> {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    const chefProfile = await this.prisma.chefProfile.findUnique({
      where: { userId: user.id },
      select: { id: true, displayName: true, stripeAccountId: true },
    });
    if (!chefProfile) {
      throw new ConflictException(
        'No chef profile yet. Complete `PATCH /me/chef-profile` first.',
      );
    }
    return {
      chefProfileId: chefProfile.id,
      displayName: chefProfile.displayName,
      email: user.email,
      stripeAccountId: chefProfile.stripeAccountId,
    };
  }
}

const idOf = (value: string | { id: string } | null | undefined): string | null =>
  typeof value === 'string' ? value : (value?.id ?? null);
