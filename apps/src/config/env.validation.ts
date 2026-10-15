import * as Joi from 'joi';

import { CLERK_SECRET_KEY_PATTERN } from '../auth/clerk-auth.guard';

export const envValidationSchema = Joi.object({
  ENVIRONMENT: Joi.string()
    .valid('development', 'staging', 'production', 'test')
    .default('development'),
  DEBUG: Joi.boolean().truthy('true').falsy('false').default(true),
  API_HOST: Joi.string().default('0.0.0.0'),
  API_PORT: Joi.number().port().optional(),
  /** Injected by Railway and similar hosts when API_PORT is unset. */
  PORT: Joi.number().port().optional(),

  SUPABASE_DB_URL: Joi.string().uri({ scheme: ['postgres', 'postgresql'] }),
  /** Direct Postgres (5432) for `npm run migration:*`. Falls back to SUPABASE_DB_URL locally. */
  SUPABASE_DB_MIGRATION_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .optional(),

  /** Optional: messaging falls back to in-process rate limiting and fan-out. */
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .allow('')
    .optional(),

  /**
   * Unverified-JWT fallback (see clerk-auth.guard.ts `shouldVerifyClerkJwt`) only kicks in
   * for the local stub or a key that doesn't match `sk_(test|live)_...` — required + pattern
   * here in production so a malformed key fails startup instead of silently disabling
   * signature verification on every guarded route.
   */
  CLERK_SECRET_KEY: Joi.string()
    .allow('')
    .optional()
    .when('ENVIRONMENT', {
      is: 'production',
      then: Joi.string().pattern(CLERK_SECRET_KEY_PATTERN).required(),
    }),
  CLERK_WEBHOOK_SIGNING_SECRET: Joi.string().allow('').optional(),
  /** Sign-in ticket handed to the frontend after `POST /auth/register`. Keep it short. */
  CLERK_SIGN_IN_TOKEN_TTL_SECONDS: Joi.number().min(600).max(6000).default(3600),

  /** Rate limit for the public registration endpoint. */
  REGISTER_THROTTLE_TTL_MS: Joi.number().min(1000).default(3_600_000),
  REGISTER_THROTTLE_LIMIT: Joi.number().min(1).default(5),
  /** Rate limit for money-moving payment endpoints (create intent / declare CESU / SEPA setup). */
  PAYMENTS_THROTTLE_TTL_MS: Joi.number().min(1000).default(60_000),
  PAYMENTS_THROTTLE_LIMIT: Joi.number().min(1).default(20),

  STRIPE_SECRET_KEY: Joi.string().allow('').optional(),
  /** Signing secret of the "Your account" Stripe webhook endpoint. */
  STRIPE_WEBHOOK_SECRET: Joi.string().allow('').optional(),
  /**
   * Signing secret of the "Connected accounts" endpoint. Required in deployed
   * environments for `account.updated`; the Stripe CLI uses one secret for both
   * scopes locally, so this can stay empty in dev.
   */
  STRIPE_CONNECT_WEBHOOK_SECRET: Joi.string().allow('').optional(),

  /** Platform commission, in basis points. 1500 = the contracted 15 % HT. */
  PAYMENTS_COMMISSION_RATE_BPS: Joi.number().min(0).max(10_000).default(1500),
  /** VAT on the commission, in basis points. 2000 = 20 % (French standard rate). */
  PAYMENTS_COMMISSION_VAT_RATE_BPS: Joi.number().min(0).max(10_000).default(2000),
  /**
   * When the commission that Stripe could not withhold at charge time is invoiced and
   * debited. `on_payment` (default) bills each CESU payment as it is confirmed;
   * `monthly_batch` defers to `POST /admin/commission-invoices/run-due`.
   */
  PAYMENTS_COMMISSION_DEBIT_TRIGGER: Joi.string()
    .valid('on_payment', 'monthly_batch')
    .default('on_payment'),
  /** Debit attempts per facture B before an admin has to step in. */
  PAYMENTS_COMMISSION_DEBIT_MAX_ATTEMPTS: Joi.number().min(1).max(10).default(3),
  /** Numbering prefix of facture B (`LF-COM-<year>-NNNN`). */
  PAYMENTS_COMMISSION_INVOICE_PREFIX: Joi.string().max(16).default('LF-COM'),

  /** Stripe Connect onboarding redirects (frontend routes on batchcooking-web). */
  STRIPE_CONNECT_REFRESH_URL: Joi.string().uri().optional(),
  STRIPE_CONNECT_RETURN_URL: Joi.string().uri().optional(),

  /**
   * The URSSAF immediate advance. `simulated` lets an admin answer in URSSAF's place,
   * so it never runs beside live Stripe keys: where real money moves, a simulated
   * payment would mark a real prestation as paid with nothing behind it.
   *
   * Tied to the Stripe key and not to `ENVIRONMENT`, because the shared test
   * deployment also runs with `ENVIRONMENT=production`.
   */
  URSSAF_GATEWAY: Joi.string()
    .valid('disabled', 'simulated')
    .default('disabled')
    .when('STRIPE_SECRET_KEY', {
      is: Joi.string()
        .pattern(/^sk_live_/)
        .required(),
      then: Joi.string().invalid('simulated'),
    }),

  BREVO_API_KEY: Joi.string().allow('').optional(),
  BREVO_SENDER_EMAIL: Joi.string().email().default('noreply@labsfood.com'),
  BREVO_SENDER_NAME: Joi.string().default('Labs Food'),

  /**
   * Brevo template ids for the FLOW-01 emails. Each is optional: an unset id makes
   * that one email a logged no-op instead of failing the operation behind it.
   */
  BREVO_TPL_APPLICATION_RECEIVED: Joi.number().optional(),
  BREVO_TPL_APPLICATION_RECEIVED_ADMIN: Joi.number().optional(),
  BREVO_TPL_DOCUMENT_REJECTED: Joi.number().optional(),
  BREVO_TPL_CHANGES_REQUESTED: Joi.number().optional(),
  BREVO_TPL_APPLICATION_REJECTED: Joi.number().optional(),
  BREVO_TPL_APPLICATION_APPROVED: Joi.number().optional(),
  BREVO_TPL_SIGN_IN_LINK: Joi.number().optional(),
  BREVO_TPL_DOCUMENT_EXPIRING: Joi.number().optional(),
  BREVO_TPL_CHEF_SUSPENDED: Joi.number().optional(),
  BREVO_TPL_SOURCE_CHANGED: Joi.number().optional(),
  BREVO_TPL_CONTENT_SUSPENDED: Joi.number().optional(),
  BREVO_TPL_NEW_MESSAGE: Joi.number().optional(),
  BREVO_TPL_CONTACT_RECEIVED_ADMIN: Joi.number().optional(),
  BREVO_TPL_CONTACT_REPLY: Joi.number().optional(),
  BREVO_TPL_QUOTE_REQUEST_CHEF: Joi.number().optional(),
  BREVO_TPL_QUOTE_NEEDS_CHEF_ADMIN: Joi.number().optional(),
  BREVO_TPL_QUOTE_OFFER_CLIENT: Joi.number().optional(),
  BREVO_TPL_QUOTE_OFFER_DECLINED_CHEF: Joi.number().optional(),
  BREVO_TPL_BOOKING_CONFIRMED: Joi.number().optional(),
  BREVO_TPL_BOOKING_HOLD_REMINDER_CLIENT: Joi.number().optional(),
  BREVO_TPL_BOOKING_HOLD_REMINDER_CHEF: Joi.number().optional(),

  /** Contact forms: who is told about a new message, and where the console lives. */
  CONTACT_NOTIFICATION_EMAIL: Joi.string().email().allow('').optional(),
  ADMIN_SITE_URL: Joi.string().uri().optional(),

  /** Structured logging, read back from Railway's log explorer. */
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace')
    .optional(),
  LOG_JSON: Joi.boolean().truthy('true').falsy('false').optional(),

  /** Base URL of the public site, for the links in the chef-onboarding emails. */
  PUBLIC_SITE_URL: Joi.string().uri().optional(),
  CHEF_APPLICATION_ADMIN_EMAIL: Joi.string().email().allow('').optional(),

  GOOGLE_MAPS_API_KEY: Joi.string().allow('').optional(),

  SUPABASE_URL: Joi.string().uri().allow('').optional(),
  SUPABASE_SERVICE_ROLE_KEY: Joi.string().allow('').optional(),
  SUPABASE_ANON_KEY: Joi.string().allow('').optional(),
  /** Private bucket for KYC documents. Must not allow public reads. */
  SUPABASE_KYC_BUCKET: Joi.string().default('labsfood-kyc'),
  /** Private bucket for conversation attachments. Must not allow public reads. */
  SUPABASE_MESSAGING_BUCKET: Joi.string().default('labsfood-messages'),
  /** Cloudflare R2 for dish and profile photos. All five, or photo routes answer 503. */
  R2_ACCOUNT_ID: Joi.string().optional(),
  R2_ACCESS_KEY_ID: Joi.string().optional(),
  R2_SECRET_ACCESS_KEY: Joi.string().optional(),
  R2_BUCKET: Joi.string().optional(),
  R2_PUBLIC_BASE_URL: Joi.string()
    .uri({ scheme: ['https'] })
    .optional(),

  /**
   * Extra origins on top of the built-in allowlist (`config/allowed-origins.ts`).
   * Left empty by default so production never inherits a localhost origin.
   */
  CORS_ORIGINS: Joi.string().allow('').optional(),
});
