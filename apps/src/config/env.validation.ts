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

  // Redis not implemented yet
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
  STRIPE_WEBHOOK_SECRET: Joi.string().allow('').optional(),

  CRONOFY_CLIENT_ID: Joi.string().allow('').optional(),
  CRONOFY_CLIENT_SECRET: Joi.string().allow('').optional(),
  CRONOFY_DATA_CENTER: Joi.string().default('us'),

  STREAM_API_KEY: Joi.string().allow('').optional(),
  STREAM_API_SECRET: Joi.string().allow('').optional(),
  STREAM_APP_ID: Joi.string().allow('').optional(),

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

  /** Structured logging, read back from Railway's log explorer. */
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace')
    .optional(),
  LOG_JSON: Joi.boolean().truthy('true').falsy('false').optional(),

  /** Base URL of the public site, for the links in the chef-onboarding emails. */
  PUBLIC_SITE_URL: Joi.string().uri().optional(),
  CHEF_APPLICATION_ADMIN_EMAIL: Joi.string().email().allow('').optional(),

  GOOGLE_MAPS_API_KEY: Joi.string().allow('').optional(),

  AWS_ACCESS_KEY_ID: Joi.string().allow('').optional(),
  AWS_SECRET_ACCESS_KEY: Joi.string().allow('').optional(),
  AWS_REGION: Joi.string().default('eu-west-3'),
  AWS_S3_BUCKET: Joi.string().allow('').optional(),

  SUPABASE_URL: Joi.string().uri().allow('').optional(),
  SUPABASE_SERVICE_ROLE_KEY: Joi.string().allow('').optional(),
  SUPABASE_ANON_KEY: Joi.string().allow('').optional(),
  SUPABASE_CMS_ASSETS_BUCKET: Joi.string().allow('').optional(),
  /** Private bucket for KYC documents. Must not allow public reads. */
  SUPABASE_KYC_BUCKET: Joi.string().default('labsfood-kyc'),

  /**
   * Extra origins on top of the built-in allowlist (`config/allowed-origins.ts`).
   * Left empty by default so production never inherits a localhost origin.
   */
  CORS_ORIGINS: Joi.string().allow('').optional(),
});
