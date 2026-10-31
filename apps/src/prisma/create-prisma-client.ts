import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { PrismaClient } from '../generated/prisma/client';
import { postgresPoolConfig } from '../supabase/db-connection';

export type PrismaLogLevel = 'query' | 'info' | 'warn' | 'error';

export interface PrismaClientBundle {
  prisma: PrismaClient;
  pool: Pool;
}

export function createPrismaClient(
  connectionString: string,
  log: PrismaLogLevel[] = ['error'],
): PrismaClientBundle {
  const pool = new Pool(postgresPoolConfig(connectionString));
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter, log });
  return { prisma, pool };
}
