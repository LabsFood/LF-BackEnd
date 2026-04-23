import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuthModule } from './auth/auth.module';
import { configLoader } from './config/config.loader';
import { HealthModule } from './modules/health/health.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { IntegrationsModule } from './integrations/integrations.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configLoader],
    }),
    HealthModule,
    AuthModule,
    IntegrationsModule,
    BookingsModule,
  ],
})
export class AppModule {}
