import { BadGatewayException, Logger } from '@nestjs/common';
import type Stripe from 'stripe';

/**
 * Stripe Accounts v2: the connected account is the chef's merchant, recipient **and**
 * customer, so the SEPA mandate hangs off the same `acct_…` instead of a separate
 * `cus_…`.
 *
 * Called with `rawRequest` and a pinned version rather than the SDK's own resources:
 * the installed SDK (17.x) predates `v2.core.accounts`, and bumping it would move every
 * v1 call (charges, webhooks) onto a new default API version. `STRIPE_V2_API_VERSION`
 * is only sent on the calls in this file and on the `customer_account` calls that need it.
 */
export const STRIPE_V2_API_VERSION = '2026-09-30.endive';

const logger = new Logger('StripeAccountsV2');
const options = { apiVersion: STRIPE_V2_API_VERSION };

/** The chef paid on the site by card and by transfer, and billed for the commission. */
export async function createConnectedAccount(
  stripe: Stripe,
  input: { chefProfileId: string },
): Promise<string> {
  const account = await call<{ id: string }>('create_account', () =>
    stripe.rawRequest(
      'POST',
      '/v2/core/accounts',
      {
        // A platform based in France may send `contact_email`, `display_name` and
        // `identity` (except `identity.country`) on a merchant account only inside an
        // account token, which only the browser can make (`account_token_required`).
        // The hosted onboarding collects them from the chef instead.
        metadata: { chefProfileId: input.chefProfileId },
        dashboard: 'express',
        // `entity_type` is left for the hosted onboarding to ask: a chef may be a
        // micro-entreprise or a company, and guessing wrong blocks the form.
        identity: { country: 'fr' },
        configuration: {
          // Card payments go out as destination charges with `on_behalf_of` (payments.service):
          // the chef is merchant of record, so the account needs `merchant` with
          // `card_payments` (Stripe adds `stripe_balance.payouts` to it, the payout to the
          // chef's bank). `recipient` (for `transfer_data`) is added after onboarding by
          // `addRecipientConfiguration`: Stripe refuses it without a contact e-mail, which
          // only the hosted onboarding may set here.
          merchant: { capabilities: { card_payments: { requested: true } } },
          // Lets the platform debit the commission from this account (`customer_account`).
          customer: {},
        },
        defaults: {
          currency: 'eur',
          locales: ['fr-FR'],
          // What a v1 Express account does: the platform pays Stripe's fees and carries
          // the losses; Stripe's hosted flow collects the requirements.
          responsibilities: {
            fees_collector: 'application_express',
            losses_collector: 'application',
          },
        },
      },
      options,
    ),
  );
  return account.id;
}

/** Single-use hosted onboarding URL for a v2 account (or a v1 one, once v2-readable). */
export async function createOnboardingLink(
  stripe: Stripe,
  accountId: string,
  urls: { refreshUrl: string; returnUrl: string },
): Promise<string> {
  const link = await call<{ url: string }>('create_account_link', () =>
    stripe.rawRequest(
      'POST',
      '/v2/core/account_links',
      {
        account: accountId,
        use_case: {
          type: 'account_onboarding',
          account_onboarding: {
            refresh_url: urls.refreshUrl,
            return_url: urls.returnUrl,
            // Upfront onboarding: the chef fills everything once, so payouts are not
            // paused later by a requirement that came due after their first bookings.
            collection_options: {
              fields: 'eventually_due',
              future_requirements: 'include',
            },
          },
        },
      },
      options,
    ),
  );
  return link.url;
}

/**
 * Makes an account usable as `customer_account`. Accounts created through v2 above
 * already have it; a chef onboarded on v1 gets it added in place, no new account.
 */
export async function addCustomerConfiguration(
  stripe: Stripe,
  accountId: string,
): Promise<void> {
  await call('add_customer_configuration', () =>
    stripe.rawRequest(
      'POST',
      `/v2/core/accounts/${accountId}`,
      { configuration: { customer: {} } },
      options,
    ),
  );
}

/**
 * `recipient` with `stripe_transfers`, the destination of `transfer_data`. Sent once the
 * hosted onboarding has given the account its contact e-mail (`account.updated`).
 */
export async function addRecipientConfiguration(
  stripe: Stripe,
  accountId: string,
): Promise<void> {
  await call('add_recipient_configuration', () =>
    stripe.rawRequest(
      'POST',
      `/v2/core/accounts/${accountId}`,
      {
        configuration: {
          recipient: {
            capabilities: { stripe_balance: { stripe_transfers: { requested: true } } },
          },
        },
      },
      options,
    ),
  );
}

/**
 * `customer` for a `cus_…`, `customer_account` for an `acct_…`: the mandate row keeps
 * either in `stripeCustomerId`, so debits created before v2 keep working untouched.
 */
export function customerRef(
  id: string,
): { customer: string } | { customer_account: string } {
  return id.startsWith('acct_') ? { customer_account: id } : { customer: id };
}

/**
 * The payment method types of a Checkout Session, SetupIntent or PaymentIntent, under
 * the parameter its API version takes: `payment_method_types` on the SDK's pinned v1
 * version, `allowed_payment_method_types` on Endive (sent with `customer_account`),
 * which answers the old one with a 400.
 */
export function paymentMethodTypes(
  id: string,
  types: string[],
): { payment_method_types: string[] } | { allowed_payment_method_types: string[] } {
  return id.startsWith('acct_')
    ? { allowed_payment_method_types: types }
    : { payment_method_types: types };
}

/** Request option for a call that carries `customer_account`. */
export const customerAccountOptions = options;

async function call<T = unknown>(step: string, run: () => Promise<unknown>): Promise<T> {
  try {
    return (await run()) as T;
  } catch (error) {
    // Never Stripe's message: it can echo the e-mail of the account.
    logger.error({ event: 'stripe.v2_call_failed', step, ...stripeErrorFields(error) });
    throw new BadGatewayException({
      code: 'STRIPE_ACCOUNTS_V2_ERROR',
      message: 'Stripe could not complete this step. Try again in a moment.',
    });
  }
}

/**
 * What a Stripe error safely tells: the parameter at fault, never Stripe's message, and
 * the `req_…` id that opens the full error in the Stripe Dashboard logs.
 */
export function stripeErrorFields(error: unknown) {
  const err = error as {
    type?: string;
    code?: string;
    param?: string;
    statusCode?: number;
    requestId?: string;
  };
  return {
    type: err.type,
    code: err.code,
    param: err.param,
    statusCode: err.statusCode,
    stripeRequestId: err.requestId,
  };
}
