import { resolveAllowedOrigins } from './allowed-origins';

export interface AppConfig {
  environment: string;
  debug: boolean;
  api: {
    host: string;
    port: number;
  };
  /** Redis not implemented yet — uncomment when enabling RedisModule. */
  // redisUrl: string;
  cors: {
    origins: string[];
  };
  /** Rate limit applied to unauthenticated public writes (`POST /auth/register`). */
  registerThrottle: {
    ttlMs: number;
    limit: number;
  };
  clerk: {
    secretKey?: string;
    webhookSigningSecret?: string;
    /** Lifetime of the sign-in ticket returned by `POST /auth/register`. */
    signInTokenTtlSeconds: number;
  };
  stripe: {
    secretKey?: string;
    /** Signing secret of the "Your account" webhook endpoint. */
    webhookSecret?: string;
    /** Signing secret of the "Connected accounts" endpoint (`account.updated`). */
    connectWebhookSecret?: string;
  };
  payments: {
    /** Platform commission on the pre-VAT amount, in basis points. 1500 = the
     * contracted 15 % HT; overridable per environment. */
    commissionRateBps: number;
    /** VAT applied on top of the commission, in basis points (2000 = 20 %). */
    commissionVatRateBps: number;
    /** Where Stripe sends a chef whose onboarding link expired. */
    stripeConnectRefreshUrl: string;
    /** Where Stripe sends a chef who finished (or abandoned) onboarding. */
    stripeConnectReturnUrl: string;
  };
  cronofy: {
    clientId?: string;
    clientSecret?: string;
    dataCenter: string;
  };
  stream: {
    apiKey?: string;
    apiSecret?: string;
    appId?: string;
  };
  brevo: {
    apiKey?: string;
    senderEmail: string;
    senderName: string;
  };
  google: {
    mapsApiKey?: string;
  };
  aws: {
    accessKeyId?: string;
    secretAccessKey?: string;
    region: string;
    s3Bucket?: string;
  };
  supabase: {
    /** Runtime app connection — Supabase pooler (6543) in cloud; direct OK locally. */
    dbUrl: string;
    /** Prisma migrate — direct session (5432) on Supabase; falls back to dbUrl locally. */
    migrationDbUrl: string;
    url?: string;
    serviceRoleKey?: string;
    anonKey?: string;
    cmsAssetsBucket?: string;
  };
}

export const configLoader = (): AppConfig => ({
  environment: process.env.ENVIRONMENT ?? 'development',
  debug: (process.env.DEBUG ?? 'true').toLowerCase() === 'true',
  api: {
    host: process.env.API_HOST ?? '0.0.0.0',
    port: Number(process.env.API_PORT ?? process.env.PORT ?? 8000),
  },
  // redisUrl: process.env.REDIS_URL ?? '',
  cors: {
    origins: resolveAllowedOrigins(process.env.CORS_ORIGINS, process.env.ENVIRONMENT),
  },
  registerThrottle: {
    ttlMs: Number(process.env.REGISTER_THROTTLE_TTL_MS ?? 3_600_000),
    limit: Number(process.env.REGISTER_THROTTLE_LIMIT ?? 5),
  },

  clerk: {
    secretKey: process.env.CLERK_SECRET_KEY,
    webhookSigningSecret: process.env.CLERK_WEBHOOK_SIGNING_SECRET,
    signInTokenTtlSeconds: Number(process.env.CLERK_SIGN_IN_TOKEN_TTL_SECONDS ?? 60),
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    connectWebhookSecret: process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
  },
  payments: {
    commissionRateBps: Number(process.env.PAYMENTS_COMMISSION_RATE_BPS ?? 1500),
    commissionVatRateBps: Number(process.env.PAYMENTS_COMMISSION_VAT_RATE_BPS ?? 2000),
    // Port 3005 is batchcooking-web (see config/allowed-origins.ts).
    stripeConnectRefreshUrl:
      process.env.STRIPE_CONNECT_REFRESH_URL ??
      'http://localhost:3005/chef/onboarding/stripe/refresh',
    stripeConnectReturnUrl:
      process.env.STRIPE_CONNECT_RETURN_URL ??
      'http://localhost:3005/chef/onboarding/stripe/return',
  },
  cronofy: {
    clientId: process.env.CRONOFY_CLIENT_ID,
    clientSecret: process.env.CRONOFY_CLIENT_SECRET,
    dataCenter: process.env.CRONOFY_DATA_CENTER ?? 'us',
  },
  stream: {
    apiKey: process.env.STREAM_API_KEY,
    apiSecret: process.env.STREAM_API_SECRET,
    appId: process.env.STREAM_APP_ID,
  },
  brevo: {
    apiKey: process.env.BREVO_API_KEY,
    senderEmail: process.env.BREVO_SENDER_EMAIL ?? 'noreply@labsfood.com',
    senderName: process.env.BREVO_SENDER_NAME ?? 'Labs Food',
  },
  google: {
    mapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
  },
  aws: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION ?? 'eu-west-3',
    s3Bucket: process.env.AWS_S3_BUCKET,
  },
  supabase: {
    dbUrl: process.env.SUPABASE_DB_URL ?? '',
    migrationDbUrl:
      process.env.SUPABASE_DB_MIGRATION_URL ??
      process.env.SUPABASE_DB_URL ??
      process.env.DATABASE_URL ??
      '',
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    anonKey: process.env.SUPABASE_ANON_KEY,
    cmsAssetsBucket: process.env.SUPABASE_CMS_ASSETS_BUCKET,
  },
});
