import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type Stripe from 'stripe';

import { StripeService } from '../../integrations/stripe.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import {
  addCustomerConfiguration,
  customerAccountOptions,
  customerRef,
} from './stripe-accounts-v2';
import {
  SepaMandateSetupIntentDto,
  SepaMandateStatusDto,
} from './dto/stripe-connect.dto';

@Injectable()
export class SepaMandatesService {
  private readonly logger = new Logger(SepaMandatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly users: UsersService,
  ) {}

  /**
   * Foundation for collecting the commission by direct debit on the flows that cannot
   * split it at charge time (avance immédiate, CESU). This phase only records the
   * mandate — **nothing is ever debited here**, and card payments do not need one
   * because Stripe Connect already withholds their commission.
   *
   * Note on the scheme: Stripe's `sepa_debit` payment method uses the SEPA **CORE**
   * scheme; the B2B scheme is not exposed by the API, so the mandate signed here is a
   * CORE mandate on the chef's account.
   *
   * The IBAN never reaches this backend: the frontend confirms the returned
   * SetupIntent with Stripe Elements, and `setup_intent.succeeded` completes the row.
   */
  async createSetupIntent(clerkUserId: string): Promise<SepaMandateSetupIntentDto> {
    if (!this.stripe.configured) {
      throw new ServiceUnavailableException(
        'Stripe is not configured (STRIPE_SECRET_KEY missing).',
      );
    }

    const { chefProfileId, displayName, email, stripeAccountId } =
      await this.requireChefProfile(clerkUserId);
    const stripe = this.stripe.getClient();

    const existing = await this.prisma.sepaMandate.findUnique({
      where: { chefProfileId },
    });

    // The chef's own connected account is the customer once they have one (Accounts v2),
    // so the mandate and the payouts sit on the same object. A `cus_…` already on the row
    // keeps being used; a chef who has not started Stripe onboarding yet still gets one.
    let customerId = existing?.stripeCustomerId ?? null;
    if (!customerId && stripeAccountId) {
      await addCustomerConfiguration(stripe, stripeAccountId);
      customerId = stripeAccountId;
    }
    if (!customerId) {
      const customer = await stripe.customers.create({
        email,
        name: displayName,
        metadata: { chefProfileId },
      });
      customerId = customer.id;
    }

    const params = {
      ...customerRef(customerId),
      payment_method_types: ['sepa_debit'],
      usage: 'off_session',
      metadata: { chefProfileId },
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
      where: { chefProfileId },
      update: fields,
      create: { chefProfileId, ...fields },
    });

    return { clientSecret: setupIntent.client_secret ?? '' };
  }

  async getStatus(clerkUserId: string): Promise<SepaMandateStatusDto | null> {
    const { chefProfileId } = await this.requireChefProfile(clerkUserId);
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

  /**
   * `setup_intent.succeeded`. Records the confirmed mandate id and the IBAN's last
   * four digits — the only part of the bank details this backend ever stores.
   */
  async handleSetupIntentSucceeded(setupIntent: Stripe.SetupIntent): Promise<void> {
    const mandate = await this.prisma.sepaMandate.findFirst({
      where: { stripeSetupIntentId: setupIntent.id },
    });
    if (!mandate) {
      this.logger.warn(
        `No SEPA mandate row for SetupIntent ${setupIntent.id}; ignoring.`,
      );
      return;
    }
    if (mandate.status === 'active') {
      return;
    }

    const paymentMethodId =
      typeof setupIntent.payment_method === 'string'
        ? setupIntent.payment_method
        : (setupIntent.payment_method?.id ?? null);
    const mandateId =
      typeof setupIntent.mandate === 'string'
        ? setupIntent.mandate
        : (setupIntent.mandate?.id ?? null);

    let ibanLast4: string | null = null;
    if (setupIntent.payment_method && typeof setupIntent.payment_method !== 'string') {
      ibanLast4 = setupIntent.payment_method.sepa_debit?.last4 ?? null;
    } else if (paymentMethodId && this.stripe.configured) {
      try {
        const paymentMethod = await this.stripe
          .getClient()
          .paymentMethods.retrieve(paymentMethodId);
        ibanLast4 = paymentMethod.sepa_debit?.last4 ?? null;
      } catch (error) {
        // The mandate itself is what matters; the masked IBAN is display-only.
        this.logger.warn(
          `Could not read PaymentMethod ${paymentMethodId}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }

    await this.prisma.sepaMandate.update({
      where: { id: mandate.id },
      data: {
        status: 'active',
        stripePaymentMethodId: paymentMethodId,
        stripeMandateId: mandateId,
        ibanLast4,
        signedAt: new Date(),
      },
    });

    this.logger.log(
      `SEPA mandate ${mandate.id} is active (SetupIntent ${setupIntent.id}).`,
    );
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
