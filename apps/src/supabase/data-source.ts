import 'reflect-metadata';

import { loadRepoEnv } from '../config/env-files';
import { DataSource, DataSourceOptions } from 'typeorm';

loadRepoEnv();

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

import { postgresSsl } from './db-connection';

const databaseUrl =
  process.env.SUPABASE_DB_MIGRATION_URL ??
  process.env.SUPABASE_DB_URL ??
  process.env.DATABASE_URL ??
  '';

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: databaseUrl,
  ssl: postgresSsl(databaseUrl),
  entities: [User, ProviderProfile, ServiceOffer, AvailabilitySlot, Booking, CmsPage],
  migrations: [Init1700000000000, AddCmsPages1700000000001],
  migrationsTableName: 'typeorm_migrations',
  synchronize: false,
  logging: process.env.DEBUG === 'true' ? ['error', 'warn', 'migration'] : ['error'],
};

const dataSource = new DataSource(dataSourceOptions);
export default dataSource;
