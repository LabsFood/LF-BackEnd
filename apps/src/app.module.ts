import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';

import { AuthModule } from './auth/auth.module';
import { configLoader } from './config/config.loader';
import { resolveEnvFilePaths } from './config/env-files';
import { envValidationSchema } from './config/env.validation';
import { DatabaseModule } from './supabase/database.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { ClerkWebhooksModule } from './modules/clerk-webhooks/clerk-webhooks.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { HealthModule } from './modules/health/health.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { QuotesModule } from './modules/quotes/quotes.module';
import { ShoppingListsModule } from './modules/shopping-lists/shopping-lists.module';
import { StatsModule } from './modules/stats/stats.module';
import { StripeWebhooksModule } from './modules/stripe-webhooks/stripe-webhooks.module';
import { ContentCmsModule } from './modules/content-cms/content-cms.module';
import { UsersModule } from './modules/users/users.module';
// ponytail: Redis not wired (cache/queues) — RedisModule/RedisService/env.REDIS_URL exist
// commented out; re-enable across app.module.ts, config.loader.ts, env.validation.ts,
// redis.module.ts, redis.service.ts and health.controller.ts when a cache or queue need shows up.
// import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolveEnvFilePaths(),
      load: [configLoader],
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
      cache: true,
    }),
    // Configured globally but enforced only where `ThrottlerGuard` is attached
    // (currently the public `POST /auth/register`), so existing routes are unaffected.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'register',
            ttl: config.get<number>('registerThrottle.ttlMs', 3_600_000),
            limit: config.get<number>('registerThrottle.limit', 5),
          },
        ],
      }),
    }),
    DatabaseModule,
    // RedisModule,
    AuthModule,
    ClerkWebhooksModule,
    StripeWebhooksModule,
    ContentCmsModule,
    IntegrationsModule,
    HealthModule,
    UsersModule,
    CatalogModule,
    ShoppingListsModule,
    QuotesModule,
    StatsModule,
    BookingsModule,
    PaymentsModule,
  ],
})
export class AppModule {}
