import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { SentryModule } from '@sentry/nestjs/setup';

import { AuditModule } from './common/audit/audit.module';
import {
  GLOBAL_THROTTLER,
  GlobalThrottlerGuard,
} from './common/throttling/global-throttler.guard';
import { AuthModule } from './auth/auth.module';
import { configLoader } from './config/config.loader';
import { resolveEnvFilePaths } from './config/env-files';
import { envValidationSchema } from './config/env.validation';
import { DatabaseModule } from './supabase/database.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { ClerkWebhooksModule } from './modules/clerk-webhooks/clerk-webhooks.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { IngredientsModule } from './modules/ingredients/ingredients.module';
import { ContactModule } from './modules/contact/contact.module';
import { HealthModule } from './modules/health/health.module';
import { GroceriesModule } from './modules/groceries/groceries.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { StripeWebhooksModule } from './modules/stripe-webhooks/stripe-webhooks.module';
import { QuotesModule } from './modules/quotes/quotes.module';
import { ShoppingListsModule } from './modules/shopping-lists/shopping-lists.module';
import { StatsModule } from './modules/stats/stats.module';
import { ChefOnboardingModule } from './modules/chef-onboarding/chef-onboarding.module';
import { DishesModule } from './modules/dishes/dishes.module';
import { ServiceOffersModule } from './modules/service-offers/service-offers.module';
import { UsersModule } from './modules/users/users.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { AllergiesModule } from './modules/allergies/allergies.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PlatformSettingsModule } from './modules/platform-settings/platform-settings.module';
import { AiModule } from './modules/ai/ai.module';
import { RecipeImportModule } from './modules/recipe-import/recipe-import.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    // Names each trace after its route (`GET /me/bookings/:id`). Errors are reported
    // by AppLogger, not by a Sentry filter: see src/instrument.ts.
    SentryModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolveEnvFilePaths(),
      load: [configLoader],
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
      cache: true,
    }),
    // `global` caps every HTTP route per IP (GlobalThrottlerGuard, below). The
    // tight `register` and `payments` limits apply only where `ThrottlerGuard`
    // is attached (registration, candidatures, payments, public pages).
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          { ...GLOBAL_THROTTLER },
          {
            name: 'register',
            ttl: config.get<number>('registerThrottle.ttlMs', 3_600_000),
            limit: config.get<number>('registerThrottle.limit', 5),
          },
          {
            name: 'payments',
            ttl: config.get<number>('paymentsThrottle.ttlMs', 60_000),
            limit: config.get<number>('paymentsThrottle.limit', 20),
          },
        ],
      }),
    }),
    // In-process scheduler for the daily chef-dossier job. No queue: see
    // ChefDossierCron for the multi-replica caveat.
    ScheduleModule.forRoot(),
    DatabaseModule,
    RedisModule,
    AuditModule,
    AuthModule,
    ClerkWebhooksModule,
    IntegrationsModule,
    HealthModule,
    UsersModule,
    CatalogModule,
    IngredientsModule,
    ShoppingListsModule,
    QuotesModule,
    StatsModule,
    BookingsModule,
    CalendarModule,
    ChefOnboardingModule,
    DishesModule,
    ServiceOffersModule,
    MessagingModule,
    NotificationsModule,
    AllergiesModule,
    ContactModule,
    PlatformSettingsModule,
    AiModule,
    RecipeImportModule,
    PaymentsModule,
    GroceriesModule,
    StripeWebhooksModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: GlobalThrottlerGuard }],
})
export class AppModule {}
