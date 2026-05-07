import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuthModule } from './auth/auth.module';
import { configLoader } from './config/config.loader';
import { envValidationSchema } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { HealthModule } from './modules/health/health.module';
import { ContentCmsModule } from './modules/content-cms/content-cms.module';
import { UsersModule } from './modules/users/users.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configLoader],
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
      cache: true,
    }),
    DatabaseModule,
    RedisModule,
    AuthModule,
    ContentCmsModule,
    IntegrationsModule,
    HealthModule,
    UsersModule,
    BookingsModule,
  ],
})
export class AppModule {}
