import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';

import { isOriginAllowed, resolveAllowedOrigins } from './allowed-origins';

@Controller('ping')
class PingController {
  @Get()
  ping(): { ok: boolean } {
    return { ok: true };
  }
}

@Module({ controllers: [PingController] })
class SmokeModule {}

describe('CORS wiring (main.ts)', () => {
  let app: NestFastifyApplication;
  const allowedOrigins = resolveAllowedOrigins(undefined, 'development');

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      SmokeModule,
      new FastifyAdapter({ logger: false }),
      { logger: false },
    );
    app.enableCors({
      origin: (origin: string | undefined, callback) => {
        callback(null, isOriginAllowed(origin, allowedOrigins));
      },
      credentials: true,
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const preflight = (origin: string) =>
    app.inject({
      method: 'OPTIONS',
      url: '/ping',
      headers: {
        origin,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization,content-type',
      },
    });

  it('echoes the origin for an allowlisted frontend', async () => {
    const res = await preflight('http://localhost:3007');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3007');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('omits the header for an unknown origin', async () => {
    const res = await preflight('http://localhost:4200');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('serves same-origin / no-Origin requests normally', async () => {
    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.statusCode).toBe(200);
  });
});
