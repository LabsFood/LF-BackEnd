import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
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
  @ApiOperation({
    summary: 'Liveness probe',
    description:
      'Returns `{ status: "ok" }` when the process is running. ' +
      'Used by Railway and load balancers; does not check database connectivity.',
  })
  @ApiOkResponse({
    description: 'Process is alive.',
    schema: { example: { status: 'ok' } },
  })
  liveness(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  @HealthCheck()
  @ApiOperation({
    summary: 'Readiness probe',
    description:
      'Checks backing services before accepting traffic. Currently pings PostgreSQL via `SELECT 1`. ' +
      'Returns `503` when the database is unreachable.',
  })
  @ApiOkResponse({ description: 'All configured dependencies are healthy.' })
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
