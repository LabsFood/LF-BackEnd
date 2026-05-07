import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  ENVIRONMENT: Joi.string()
    .valid('development', 'staging', 'production', 'test')
    .default('development'),
  DEBUG: Joi.boolean().truthy('true').falsy('false').default(true),
  API_HOST: Joi.string().default('0.0.0.0'),
  API_PORT: Joi.number().port().default(8000),

  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .required(),

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
  BREVO_SENDER_EMAIL: Joi.string().email().default('noreply@example.com'),
  BREVO_SENDER_NAME: Joi.string().default('Labs Food'),

  GOOGLE_MAPS_API_KEY: Joi.string().allow('').optional(),

  AWS_ACCESS_KEY_ID: Joi.string().allow('').optional(),
  AWS_SECRET_ACCESS_KEY: Joi.string().allow('').optional(),
  AWS_REGION: Joi.string().default('eu-west-3'),
  AWS_S3_BUCKET: Joi.string().allow('').optional(),

  CORS_ORIGINS: Joi.string().default('http://localhost:3000'),
});
