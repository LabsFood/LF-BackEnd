import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { PrismaClient } from '../generated/prisma/client';
import { postgresPoolConfig } from '../supabase/db-connection';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly pool: Pool;

  constructor(config: ConfigService) {
    const pool = new Pool(
      postgresPoolConfig(config.getOrThrow<string>('supabase.dbUrl')),
    );
    const adapter = new PrismaPg(pool);
    const log = config.get<boolean>('debug')
      ? (['warn', 'error'] as const)
      : (['error'] as const);
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
