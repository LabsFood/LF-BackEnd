import { resolveAllowedOrigins } from './allowed-origins';

/** Env vars are strings; an unset or unparseable template id stays undefined. */
const optionalNumber = (value?: string): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export interface AppConfig {
  environment: string;
  debug: boolean;
  api: {
    host: string;
    port: number;
  };
  /**
   * Optional. Without it the messaging rate limit and realtime fan-out stay inside
   * this process, which is right for one instance and for local development.
   */
  redisUrl?: string;
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
    webhookSecret?: string;
  };
  cronofy: {
    clientId?: string;
    clientSecret?: string;
    dataCenter: string;
  };
  brevo: {
    apiKey?: string;
    senderEmail: string;
    senderName: string;
    /** Brevo template ids; an absent id turns that email into a logged no-op. */
    templates: {
      applicationReceived?: number;
      applicationReceivedAdmin?: number;
      documentRejected?: number;
      changesRequested?: number;
      applicationRejected?: number;
      applicationApproved?: number;
      signInLink?: number;
      documentExpiring?: number;
      chefSuspended?: number;
      sourceChanged?: number;
      contentSuspended?: number;
      newMessage?: number;
      contactReceivedAdmin?: number;
      contactReply?: number;
      quoteRequestChef?: number;
      quoteNeedsChefAdmin?: number;
      quoteOfferClient?: number;
      quoteOfferDeclinedChef?: number;
      bookingConfirmed?: number;
    };
  };
  /** Structured stdout logging, read by Railway's log explorer. */
  logging: {
    level: string;
    /** JSON lines in production, human-readable locally. */
    json: boolean;
  };
  chefOnboarding: {
    /**
     * The batch cooking site, for the links in the chef-onboarding emails: sign-in,
     * dossier, dashboard. It must use the same Clerk instance as this API, or the
     * sign-in link is refused.
     */
    publicSiteUrl: string;
    /** Where the internal "new candidature" notification goes. */
    adminNotificationEmail?: string;
  };
  /** The public contact forms and the admin inbox they feed. */
  contact: {
    /** Where the "new contact message" heads-up goes. Unset: no email, the inbox only. */
    notificationEmail?: string;
    /** The admin console, for the link in that email. */
    adminSiteUrl: string;
  };
  google: {
    mapsApiKey?: string;
  };
  supabase: {
    /** Runtime app connection — Supabase pooler (6543) in cloud; direct OK locally. */
    dbUrl: string;
    /** Prisma migrate — direct session (5432) on Supabase; falls back to dbUrl locally. */
    migrationDbUrl: string;
    url?: string;
    serviceRoleKey?: string;
    anonKey?: string;
    /** Private bucket holding KYC documents. Never publicly readable. */
    kycBucket: string;
    /** Private bucket holding the files sent in conversations. Never publicly readable. */
    messagingBucket: string;
  };
  /**
   * Cloudflare R2, for dish and profile photos (FLOW-02). Optional: without all five, photo
   * routes answer 503 PHOTOS_UNAVAILABLE and the rest of the API is unaffected.
   */
  r2: {
    accountId?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    bucket?: string;
    /** Public address of the bucket (custom domain or r2.dev URL). */
    publicBaseUrl?: string;
  };
}

export const configLoader = (): AppConfig => ({
  environment: process.env.ENVIRONMENT ?? 'development',
  debug: (process.env.DEBUG ?? 'true').toLowerCase() === 'true',
  api: {
    host: process.env.API_HOST ?? '0.0.0.0',
    port: Number(process.env.API_PORT ?? process.env.PORT ?? 8000),
  },
  redisUrl: process.env.REDIS_URL || undefined,
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
  },
  cronofy: {
    clientId: process.env.CRONOFY_CLIENT_ID,
    clientSecret: process.env.CRONOFY_CLIENT_SECRET,
    dataCenter: process.env.CRONOFY_DATA_CENTER ?? 'us',
  },
  brevo: {
    apiKey: process.env.BREVO_API_KEY,
    senderEmail: process.env.BREVO_SENDER_EMAIL ?? 'noreply@labsfood.com',
    senderName: process.env.BREVO_SENDER_NAME ?? 'Labs Food',
    templates: {
      applicationReceived: optionalNumber(process.env.BREVO_TPL_APPLICATION_RECEIVED),
      applicationReceivedAdmin: optionalNumber(
        process.env.BREVO_TPL_APPLICATION_RECEIVED_ADMIN,
      ),
      documentRejected: optionalNumber(process.env.BREVO_TPL_DOCUMENT_REJECTED),
      changesRequested: optionalNumber(process.env.BREVO_TPL_CHANGES_REQUESTED),
      applicationRejected: optionalNumber(process.env.BREVO_TPL_APPLICATION_REJECTED),
      applicationApproved: optionalNumber(process.env.BREVO_TPL_APPLICATION_APPROVED),
      signInLink: optionalNumber(process.env.BREVO_TPL_SIGN_IN_LINK),
      documentExpiring: optionalNumber(process.env.BREVO_TPL_DOCUMENT_EXPIRING),
      chefSuspended: optionalNumber(process.env.BREVO_TPL_CHEF_SUSPENDED),
      sourceChanged: optionalNumber(process.env.BREVO_TPL_SOURCE_CHANGED),
      contentSuspended: optionalNumber(process.env.BREVO_TPL_CONTENT_SUSPENDED),
      newMessage: optionalNumber(process.env.BREVO_TPL_NEW_MESSAGE),
      contactReceivedAdmin: optionalNumber(process.env.BREVO_TPL_CONTACT_RECEIVED_ADMIN),
      contactReply: optionalNumber(process.env.BREVO_TPL_CONTACT_REPLY),
      quoteRequestChef: optionalNumber(process.env.BREVO_TPL_QUOTE_REQUEST_CHEF),
      quoteNeedsChefAdmin: optionalNumber(process.env.BREVO_TPL_QUOTE_NEEDS_CHEF_ADMIN),
      quoteOfferClient: optionalNumber(process.env.BREVO_TPL_QUOTE_OFFER_CLIENT),
      quoteOfferDeclinedChef: optionalNumber(
        process.env.BREVO_TPL_QUOTE_OFFER_DECLINED_CHEF,
      ),
      bookingConfirmed: optionalNumber(process.env.BREVO_TPL_BOOKING_CONFIRMED),
    },
  },
  logging: {
    level:
      process.env.LOG_LEVEL ??
      (process.env.ENVIRONMENT === 'production' ? 'info' : 'debug'),
    json:
      (process.env.LOG_JSON ?? String(process.env.ENVIRONMENT === 'production')) ===
      'true',
  },
  chefOnboarding: {
    publicSiteUrl: process.env.PUBLIC_SITE_URL ?? 'https://batchcooking.labsfood.fr',
    adminNotificationEmail: process.env.CHEF_APPLICATION_ADMIN_EMAIL,
  },
  contact: {
    notificationEmail: process.env.CONTACT_NOTIFICATION_EMAIL || undefined,
    adminSiteUrl: process.env.ADMIN_SITE_URL ?? 'https://admin.labsfood.fr',
  },
  google: {
    mapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
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
    kycBucket: process.env.SUPABASE_KYC_BUCKET ?? 'labsfood-kyc',
    messagingBucket: process.env.SUPABASE_MESSAGING_BUCKET ?? 'labsfood-messages',
  },
  r2: {
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucket: process.env.R2_BUCKET,
    publicBaseUrl: process.env.R2_PUBLIC_BASE_URL,
  },
});
