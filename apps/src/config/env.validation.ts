import * as Joi from 'joi';

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

  // ponytail: Redis not wired — see app.module.ts. Uncomment alongside the module.
  // REDIS_URL: Joi.string()
  //   .uri({ scheme: ['redis', 'rediss'] })
  //   .required(),

  CLERK_SECRET_KEY: Joi.string().allow('').optional(),
  CLERK_WEBHOOK_SIGNING_SECRET: Joi.string().allow('').optional(),
  /** Sign-in ticket handed to the frontend after `POST /auth/register`. Keep it short. */
  CLERK_SIGN_IN_TOKEN_TTL_SECONDS: Joi.number().min(600).max(6000).default(3600),

  /** Rate limit for the public registration endpoint. */
  REGISTER_THROTTLE_TTL_MS: Joi.number().min(1000).default(3_600_000),
  REGISTER_THROTTLE_LIMIT: Joi.number().min(1).default(5),

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

  CRONOFY_CLIENT_ID: Joi.string().allow('').optional(),
  CRONOFY_CLIENT_SECRET: Joi.string().allow('').optional(),
  CRONOFY_DATA_CENTER: Joi.string().default('us'),

  STREAM_API_KEY: Joi.string().allow('').optional(),
  STREAM_API_SECRET: Joi.string().allow('').optional(),
  STREAM_APP_ID: Joi.string().allow('').optional(),

  BREVO_API_KEY: Joi.string().allow('').optional(),
  BREVO_SENDER_EMAIL: Joi.string().email().default('noreply@labsfood.com'),
  BREVO_SENDER_NAME: Joi.string().default('Labs Food'),

  GOOGLE_MAPS_API_KEY: Joi.string().allow('').optional(),

  AWS_ACCESS_KEY_ID: Joi.string().allow('').optional(),
  AWS_SECRET_ACCESS_KEY: Joi.string().allow('').optional(),
  AWS_REGION: Joi.string().default('eu-west-3'),
  AWS_S3_BUCKET: Joi.string().allow('').optional(),

  SUPABASE_URL: Joi.string().uri().allow('').optional(),
  SUPABASE_SERVICE_ROLE_KEY: Joi.string().allow('').optional(),
  SUPABASE_ANON_KEY: Joi.string().allow('').optional(),
  SUPABASE_CMS_ASSETS_BUCKET: Joi.string().allow('').optional(),

  /**
   * Extra origins on top of the built-in allowlist (`config/allowed-origins.ts`).
   * Left empty by default so production never inherits a localhost origin.
   */
  CORS_ORIGINS: Joi.string().allow('').optional(),
});
