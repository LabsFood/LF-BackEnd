import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';

import { corsOptions, resolveAllowedOrigins } from './allowed-origins';

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
  const rejected = jest.fn();

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      SmokeModule,
      new FastifyAdapter({ logger: false }),
      { logger: false },
    );
    // The options main.ts passes, not a copy of them.
    app.enableCors(
      corsOptions(resolveAllowedOrigins(undefined, 'development'), rejected),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const preflight = (origin: string, method = 'GET') =>
    app.inject({
      method: 'OPTIONS',
      url: '/ping',
      headers: {
        origin,
        'access-control-request-method': method,
        'access-control-request-headers': 'authorization,content-type',
      },
    });

  it('echoes the origin for an allowlisted frontend', async () => {
    const res = await preflight('http://localhost:3007');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3007');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('omits the header for an unknown origin, and reports it', async () => {
    const res = await preflight('http://localhost:4200');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(rejected).toHaveBeenCalledWith('http://localhost:4200');
  });

  // Swagger is served by the API itself, same origin, so it can never show this:
  // a method missing here is cancelled by the browser before the request leaves.
  it.each(['PATCH', 'PUT', 'DELETE'])('lets a browser send %s', async (method) => {
    const res = await preflight('http://localhost:3005', method);
    expect(res.headers['access-control-allow-methods']).toContain(method);
  });

  it('serves same-origin / no-Origin requests normally', async () => {
    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.statusCode).toBe(200);
  });
});
