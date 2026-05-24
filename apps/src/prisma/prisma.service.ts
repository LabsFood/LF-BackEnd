import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { PrismaClient } from '../generated/prisma/client';
import { postgresSsl } from '../supabase/db-connection';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly pool: Pool;

  constructor(config: ConfigService) {
    const dbUrl = config.getOrThrow<string>('supabase.dbUrl');
    const ssl = postgresSsl(dbUrl);
    const pool = new Pool({
      connectionString: dbUrl,
      ...(ssl ? { ssl } : {}),
    });
    const adapter = new PrismaPg(pool);
    const log = config.get<boolean>('debug') ? (['warn', 'error'] as const) : (['error'] as const);
    super({ adapter, log: [...log] });
    this.pool = pool;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected to PostgreSQL.');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    await this.pool.end();
  }
}
