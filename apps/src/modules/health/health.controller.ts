import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import type { HealthCheckResult } from '@nestjs/terminus';

import { PrismaService } from '../../prisma/prisma.service';

// Redis not implemented yet — re-enable ping in readiness when RedisModule is on.
// import { RedisService } from '../../redis/redis.service';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaService,
    // private readonly redis: RedisService,
  ) {}

  @Get('health')
  @ApiOkResponse({ description: 'Liveness probe.' })
  liveness(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  @HealthCheck()
  @ApiOkResponse({ description: 'Readiness probe (database).' })
  async readiness(): Promise<HealthCheckResult> {
    return this.health.check([
      async () => {
        await this.prisma.$queryRaw`SELECT 1`;
        return { database: { status: 'up' } };
      },
      // async () => {
      //   await this.redis.$queryRaw`SELECT 1`;
      //   return { database: { status: 'up' } };
      // }
    ]);
  }
}
