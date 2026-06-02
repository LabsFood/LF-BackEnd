import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuthModule } from './auth/auth.module';
import { configLoader } from './config/config.loader';
import { resolveEnvFilePaths } from './config/env-files';
import { envValidationSchema } from './config/env.validation';
import { DatabaseModule } from './supabase/database.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { HealthModule } from './modules/health/health.module';
import { QuotesModule } from './modules/quotes/quotes.module';
import { ShoppingListsModule } from './modules/shopping-lists/shopping-lists.module';
import { StatsModule } from './modules/stats/stats.module';
import { ContentCmsModule } from './modules/content-cms/content-cms.module';
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
    DatabaseModule,
    // RedisModule,
    AuthModule,
    ContentCmsModule,
    IntegrationsModule,
    HealthModule,
    UsersModule,
    CatalogModule,
    ShoppingListsModule,
    QuotesModule,
    StatsModule,
    BookingsModule,
  ],
})
export class AppModule {}
