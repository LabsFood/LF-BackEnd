import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  AvailabilitySlot,
  Booking,
  ProviderProfile,
  ServiceOffer,
  User,
} from './entities';
import { Init1700000000000 } from './migrations/1700000000000-init';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.getOrThrow<string>('databaseUrl'),
        entities: [User, ProviderProfile, ServiceOffer, AvailabilitySlot, Booking],
        migrations: [Init1700000000000],
        migrationsTableName: 'typeorm_migrations',
        migrationsRun: true,
        synchronize: false,
        autoLoadEntities: true,
        logging: config.get<boolean>('debug')
          ? ['error', 'warn', 'migration']
          : ['error'],
      }),
    }),
  ],
})
export class DatabaseModule {}
