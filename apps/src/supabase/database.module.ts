import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  isLocalPostgresUrl,
  isSupabasePoolerUrl,
  postgresSsl,
} from './db-connection';
import {
  AvailabilitySlot,
  Booking,
  CmsPage,
  ProviderProfile,
  ServiceOffer,
  User,
} from './entities';
import { Init1700000000000 } from './migrations/1700000000000-init';
import { AddCmsPages1700000000001 } from './migrations/1700000000001-add-cms-pages';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const dbUrl = config.getOrThrow<string>('supabase.dbUrl');
        const usePooler = isSupabasePoolerUrl(dbUrl);
        return {
          type: 'postgres' as const,
          url: dbUrl,
          ssl: postgresSsl(dbUrl),
          entities: [
            User,
            ProviderProfile,
            ServiceOffer,
            AvailabilitySlot,
            Booking,
            CmsPage,
          ],
          migrations: [
            Init1700000000000,
            AddCmsPages1700000000001,
          ],
          migrationsTableName: 'typeorm_migrations',
          // PgBouncer transaction mode cannot run DDL; use CLI + SUPABASE_DB_MIGRATION_URL.
          migrationsRun: isLocalPostgresUrl(dbUrl) && !usePooler,
          synchronize: false,
          autoLoadEntities: true,
          extra: usePooler ? { max: 10 } : undefined,
          logging: config.get<boolean>('debug')
            ? ['error', 'warn', 'migration']
            : ['error'],
        };
      },
    }),
  ],
})
export class DatabaseModule {}
