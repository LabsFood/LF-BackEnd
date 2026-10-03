import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import type { HealthCheckResult } from '@nestjs/terminus';

import { TAGS } from '../../common/swagger/tags';
import { PrismaService } from '../../prisma/prisma.service';

// Redis not implemented yet — re-enable ping in readiness when RedisModule is on.
// import { RedisService } from '../../redis/redis.service';

@ApiTags(TAGS.health)
@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaService,
    // private readonly redis: RedisService,
  ) {}

  @Get('health')
  @ApiOperation({
    summary: 'Is the API running?',
    description:
      'Answers `200` as long as the process is up. It checks nothing else, so it stays ' +
      'green during a database outage: use `GET /ready` to know whether requests can be ' +
      'served. Railway calls this one to decide whether to restart the container.',
  })
  @ApiOkResponse({
    description: 'The process is up.',
    schema: { example: { status: 'ok' } },
  })
  liveness(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  @HealthCheck()
  @ApiOperation({
    summary: 'Can the API serve requests?',
    description:
      'Runs `SELECT 1` against the database. Answers `200` when it succeeds and `503` ' +
      'when the database cannot be reached, so a deploy is only sent traffic once it is ' +
      'actually usable.',
  })
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
