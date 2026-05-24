import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { PrismaClient } from '../generated/prisma/client';
import { postgresSsl } from '../supabase/db-connection';

export type PrismaLogLevel = 'query' | 'info' | 'warn' | 'error';

export interface PrismaClientBundle {
  prisma: PrismaClient;
  pool: Pool;
}

export function createPrismaClient(
  connectionString: string,
  log: PrismaLogLevel[] = ['error'],
): PrismaClientBundle {
  const ssl = postgresSsl(connectionString);
  const pool = new Pool({
    connectionString,
    ...(ssl ? { ssl } : {}),
  });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter, log });
  return { prisma, pool };
}
