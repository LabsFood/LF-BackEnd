import 'reflect-metadata';

import { DataSource, DataSourceOptions } from 'typeorm';

import {
  AvailabilitySlot,
  Booking,
  ProviderProfile,
  ServiceOffer,
  User,
} from './entities';
import { Init1700000000000 } from './migrations/1700000000000-init';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://lf:lf@localhost:5432/lf_backend';

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: databaseUrl,
  entities: [User, ProviderProfile, ServiceOffer, AvailabilitySlot, Booking],
  migrations: [Init1700000000000],
  migrationsTableName: 'typeorm_migrations',
  synchronize: false,
  logging: process.env.DEBUG === 'true' ? ['error', 'warn', 'migration'] : ['error'],
};

const dataSource = new DataSource(dataSourceOptions);
export default dataSource;
