import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    const dbUrl = config.getOrThrow<string>('supabase.dbUrl');
    super({
      datasources: { db: { url: dbUrl } },
      log: config.get<boolean>('debug') ? ['warn', 'error'] : ['error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected to PostgreSQL.');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
