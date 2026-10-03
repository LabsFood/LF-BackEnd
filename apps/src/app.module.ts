import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';

import { AuditModule } from './common/audit/audit.module';
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
import { QuotesModule } from './modules/quotes/quotes.module';
import { ShoppingListsModule } from './modules/shopping-lists/shopping-lists.module';
import { StatsModule } from './modules/stats/stats.module';
import { ChefOnboardingModule } from './modules/chef-onboarding/chef-onboarding.module';
import { DishesModule } from './modules/dishes/dishes.module';
import { UsersModule } from './modules/users/users.module';
// Redis not implemented yet — re-enable when cache/queues are wired.
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
    // In-process scheduler for the daily chef-dossier job. No queue: see
    // ChefDossierCron for the multi-replica caveat.
    ScheduleModule.forRoot(),
    DatabaseModule,
    // RedisModule,
    AuditModule,
    AuthModule,
    ClerkWebhooksModule,
    IntegrationsModule,
    HealthModule,
    UsersModule,
    CatalogModule,
    ShoppingListsModule,
    QuotesModule,
    StatsModule,
    BookingsModule,
    ChefOnboardingModule,
    DishesModule,
  ],
})
export class AppModule {}
