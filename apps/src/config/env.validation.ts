import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  ENVIRONMENT: Joi.string()
    .valid('development', 'staging', 'production', 'test')
    .default('development'),
  DEBUG: Joi.boolean().truthy('true').falsy('false').default(true),
  API_HOST: Joi.string().default('0.0.0.0'),
  API_PORT: Joi.number().port().default(8000),

  SUPABASE_DB_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] }),
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

  GOOGLE_MAPS_API_KEY: Joi.string().allow('').optional(),

  AWS_ACCESS_KEY_ID: Joi.string().allow('').optional(),
  AWS_SECRET_ACCESS_KEY: Joi.string().allow('').optional(),
  AWS_REGION: Joi.string().default('eu-west-3'),
  AWS_S3_BUCKET: Joi.string().allow('').optional(),

  SUPABASE_URL: Joi.string().uri().allow('').optional(),
  SUPABASE_SERVICE_ROLE_KEY: Joi.string().allow('').optional(),
  SUPABASE_ANON_KEY: Joi.string().allow('').optional(),
  SUPABASE_CMS_ASSETS_BUCKET: Joi.string().allow('').optional(),

  CORS_ORIGINS: Joi.string().default('http://localhost:3000'),
});
