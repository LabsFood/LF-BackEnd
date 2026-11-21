import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Stripe from 'stripe';

import { ChefProfile } from '../../generated/prisma/client';
import { StripeService } from '../../integrations/stripe.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { StripeConnectLinkDto, StripeConnectStatusDto } from './dto/stripe-connect.dto';
import { createConnectedAccount, createOnboardingLink } from './stripe-accounts-v2';

@Injectable()
export class StripeConnectService {
  private readonly logger = new Logger(StripeConnectService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly config: ConfigService,
    private readonly users: UsersService,
  ) {}

  /**
   * Hosted onboarding link for the authenticated chef, creating the Accounts v2
   * account (Express dashboard) on first call. Account links are single-use and short-lived, so a fresh one is minted
   * on every call rather than stored.
   */
  async createOnboardingLink(
    clerkUserId: string,
    accountToken?: string,
  ): Promise<StripeConnectLinkDto> {
    this.assertStripeConfigured();
    const { chefProfile } = await this.requireChefProfile(clerkUserId);
    const stripe = this.stripe.getClient();

    let accountId = chefProfile.stripeAccountId;
    if (!accountId) {
      // Checked before Stripe: without the token the call can only fail.
      if (!accountToken) {
        throw new BadRequestException({
          code: 'STRIPE_ACCOUNT_TOKEN_REQUIRED',
          message: 'Creating the Stripe account needs an account token from the browser.',
        });
      }
      accountId = await createConnectedAccount(stripe, {
        chefProfileId: chefProfile.id,
        accountToken,
      });
      await this.prisma.chefProfile.update({
        where: { id: chefProfile.id },
        data: { stripeAccountId: accountId },
      });
      this.logger.log({
        event: 'stripe.account_created',
        accountsApi: 'v2',
        accountId,
        chefProfileId: chefProfile.id,
      });
    }

    const url = await createOnboardingLink(stripe, accountId, {
      refreshUrl: this.config.getOrThrow<string>('payments.stripeConnectRefreshUrl'),
      returnUrl: this.config.getOrThrow<string>('payments.stripeConnectReturnUrl'),
    });

    return { url };
  }

  /**
   * One-time link into the chef's own Stripe Express dashboard (balance, payouts,
   * bank account). The frontend sends the chef there when they come back from
   * onboarding. Stripe refuses it before the onboarding form is submitted, so that
   * case is a clear 409 rather than a Stripe error.
   */
  async createDashboardLink(clerkUserId: string): Promise<StripeConnectLinkDto> {
    this.assertStripeConfigured();
    const { chefProfile } = await this.requireChefProfile(clerkUserId);
    if (!chefProfile.stripeAccountId || !chefProfile.stripeDetailsSubmitted) {
      throw new ConflictException({
        code: 'STRIPE_ONBOARDING_INCOMPLETE',
        message: 'Finish Stripe onboarding first: there is no dashboard to open yet.',
      });
    }
    const link = await this.stripe
      .getClient()
      .accounts.createLoginLink(chefProfile.stripeAccountId);
    return { url: link.url };
  }

  /**
   * Onboarding state as last mirrored from Stripe. Read from Postgres, not from the
   * Stripe API: `account.updated` keeps the columns current and this route is polled
   * by the frontend while the chef finishes onboarding.
   */
  async getStatus(clerkUserId: string): Promise<StripeConnectStatusDto> {
    const { chefProfile } = await this.requireChefProfile(clerkUserId);
    return {
      stripeAccountId: chefProfile.stripeAccountId,
      chargesEnabled: chefProfile.stripeChargesEnabled,
      payoutsEnabled: chefProfile.stripePayoutsEnabled,
      detailsSubmitted: chefProfile.stripeDetailsSubmitted,
    };
  }

  /**
   * `account.updated`. A straight copy of the three Stripe flags — no derived state
   * machine to drift out of sync. `updateMany` keyed on the account id makes the write
   * idempotent and a no-op for accounts this platform does not know.
   */
  async handleAccountUpdated(account: Stripe.Account): Promise<void> {
    const { count } = await this.prisma.chefProfile.updateMany({
      where: { stripeAccountId: account.id },
      data: {
        stripeChargesEnabled: account.charges_enabled ?? false,
        stripePayoutsEnabled: account.payouts_enabled ?? false,
        stripeDetailsSubmitted: account.details_submitted ?? false,
      },
    });
    if (count === 0) {
      this.logger.warn(`No chef profile for Stripe account ${account.id}; ignoring.`);
      return;
    }
    this.logger.log(
      `Synced Stripe account ${account.id}: charges=${account.charges_enabled} ` +
        `payouts=${account.payouts_enabled} details=${account.details_submitted}`,
    );
  }

  private assertStripeConfigured(): void {
    if (!this.stripe.configured) {
      throw new ServiceUnavailableException(
        'Stripe is not configured (STRIPE_SECRET_KEY missing).',
      );
    }
  }

  private async requireChefProfile(
    clerkUserId: string,
  ): Promise<{ chefProfile: ChefProfile }> {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    const chefProfile = await this.prisma.chefProfile.findUnique({
      where: { userId: user.id },
    });
    if (!chefProfile) {
      throw new ConflictException(
        'No chef profile yet. Complete `PATCH /me/chef-profile` first.',
      );
    }
    return { chefProfile };
  }
}
