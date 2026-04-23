import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  /** Liveness probe returning a constant healthy payload. */
  @Get('health')
  health(): { status: string } {
    return { status: 'ok' };
  }

  /** Readiness probe placeholder; extend with real DB/Redis checks in Phase 2. */
  @Get('ready')
  ready(): { status: string; api: string } {
    return { status: 'ok', api: 'ok' };
  }
}
