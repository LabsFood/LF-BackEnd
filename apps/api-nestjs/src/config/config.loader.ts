export interface AppConfig {
  environment: string;
  databaseUrl: string;
  redisUrl: string;
  clerk: {
    secretKey?: string;
    webhookSigningSecret?: string;
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
}

/** Build the typed app config object read from process environment variables. */
export const configLoader = (): AppConfig => ({
  environment: process.env.ENVIRONMENT ?? 'development',
  databaseUrl: process.env.DATABASE_URL ?? '',
  redisUrl: process.env.REDIS_URL ?? '',
  clerk: {
    secretKey: process.env.CLERK_SECRET_KEY,
    webhookSigningSecret: process.env.CLERK_WEBHOOK_SIGNING_SECRET,
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
  stream: {
    apiKey: process.env.STREAM_API_KEY,
    apiSecret: process.env.STREAM_API_SECRET,
    appId: process.env.STREAM_APP_ID,
  },
  brevo: {
    apiKey: process.env.BREVO_API_KEY,
    senderEmail: process.env.BREVO_SENDER_EMAIL ?? 'noreply@example.com',
    senderName: process.env.BREVO_SENDER_NAME ?? 'Labs Food',
  },
});
