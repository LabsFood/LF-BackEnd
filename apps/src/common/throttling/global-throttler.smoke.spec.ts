import { Controller, Get, Module } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { SkipThrottle, ThrottlerModule } from '@nestjs/throttler';

import { trustRailwayEdge } from '../../config/trusted-proxy';
import { GLOBAL_THROTTLER, GlobalThrottlerGuard } from './global-throttler.guard';

@Controller()
class RoutesController {
  @Get('any')
  any(): { ok: boolean } {
    return { ok: true };
  }

  @Get('webhook')
  @SkipThrottle({ global: true })
  webhook(): { ok: boolean } {
    return { ok: true };
  }
}

// The wiring of app.module.ts and main.ts, with a limit of 2 instead of 300.
@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [
        { ...GLOBAL_THROTTLER, limit: 2 },
        { name: 'register', ttl: 3_600_000, limit: 1 },
      ],
    }),
  ],
  controllers: [RoutesController],
  providers: [{ provide: APP_GUARD, useClass: GlobalThrottlerGuard }],
})
class SmokeModule {}

describe('global rate limit wiring (app.module.ts + main.ts)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      SmokeModule,
      new FastifyAdapter({ logger: false, trustProxy: trustRailwayEdge }),
      { logger: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (url: string, client: string, spoofed?: string) =>
    app.inject({
      method: 'GET',
      url,
      remoteAddress: '10.0.0.1', // Railway's edge
      headers: { 'x-forwarded-for': spoofed ? `${spoofed}, ${client}` : client },
    });

  it('answers 429 past the limit, whatever X-Forwarded-For the client adds', async () => {
    expect((await get('/any', '203.0.113.1', '1.1.1.1')).statusCode).toBe(200);
    expect((await get('/any', '203.0.113.1', '2.2.2.2')).statusCode).toBe(200);
    expect((await get('/any', '203.0.113.1', '3.3.3.3')).statusCode).toBe(429);
  });

  it('keeps one bucket per client, and never applies the route-level limits', async () => {
    // `register` (limit 1) would refuse the second request if it applied here.
    expect((await get('/any', '203.0.113.2')).statusCode).toBe(200);
    expect((await get('/any', '203.0.113.2')).statusCode).toBe(200);
  });

  it('leaves exempted routes (webhooks, health) alone', async () => {
    for (let i = 0; i < 4; i++) {
      expect((await get('/webhook', '203.0.113.3')).statusCode).toBe(200);
    }
  });
});
