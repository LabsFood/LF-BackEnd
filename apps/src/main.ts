import 'reflect-metadata';

import helmet from '@fastify/helmet';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { LogController } from 'fastify';
import { WsAdapter } from '@nestjs/platform-ws';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Http2ServerRequest } from 'node:http2';
import { SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { registerWebhookRawBodyHook } from './auth/fastify-raw-body';
import { AllExceptionsFilter } from './common/logging/all-exceptions.filter';
import { AppLogger, LOG_BASE } from './common/logging/app-logger';
import { registerRequestContext } from './common/logging/request-context';
import { ApiValidationPipe } from './common/validation.pipe';
import { corsOptions, resolveAllowedOrigins } from './config/allowed-origins';
import { distrustCompromisedRoots } from './config/trusted-roots';
import { buildOpenApiDocument } from './swagger';

/**
 * Structured logging so Railway's log explorer can filter on fields rather than
 * grep a text blob.
 *
 * Both halves are already paid for: Fastify bundles pino for access logs, and
 * Nest 11's ConsoleLogger emits JSON natively. No logging dependency is added.
 *
 * `LOG_JSON` defaults to true in production and false locally, where readable
 * lines beat parseable ones.
 *
 * Both write the same keys (`level`, `message`, `timestamp`, `requestId`, `service`,
 * `env`, `version`), so an aggregator reads them as one stream.
 */
const jsonLogging =
  (process.env.LOG_JSON ?? String(process.env.ENVIRONMENT === 'production')) === 'true';
const logLevel =
  process.env.LOG_LEVEL ?? (process.env.ENVIRONMENT === 'production' ? 'info' : 'debug');

async function bootstrap(): Promise<void> {
  // Before the first connection (Prisma, Stripe, Clerk...): src/config/trusted-roots.ts.
  const distrustedRoots = distrustCompromisedRoots();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      // Access logs (method, path, status, duration) with a request id that also
      // lands in `audit_log.request_id`, so a Railway line and a database row can
      // be joined when debugging one candidature.
      logger: jsonLogging
        ? {
            level: logLevel,
            base: { pid: process.pid, ...LOG_BASE },
            messageKey: 'message',
            timestamp: () => `,"timestamp":${Date.now()}`,
            formatters: { level: (label: string) => ({ level: label }) },
            serializers: {
              // The path without its query string (searches can hold a name or an
              // email), and never a calendar feed's secret.
              req: (req: { id: string; method: string; url: string }) => ({
                method: req.method,
                url: req.url
                  .split('?')[0]
                  .replace(/^\/calendar\/feed\/[^/]+/, '/calendar/feed/:token'),
              }),
            },
          }
        : false,
      logController: new LogController({ requestIdLogLabel: 'requestId' }),
      // Honour an inbound id from the proxy so a trace survives across services.
      genReqId: (req: IncomingMessage | Http2ServerRequest) =>
        (req.headers['x-request-id'] as string | undefined)?.slice(0, 64) ?? randomUUID(),
      trustProxy: true,
    }),
    {
      bufferLogs: true,
      logger: new AppLogger({ json: jsonLogging, colors: !jsonLogging }),
    },
  );
  const logger = new Logger('Bootstrap');
  logger.log(`TLS: ${distrustedRoots} eMudhra (emSign) root CAs distrusted`);
  const config = app.get(ConfigService);

  const fastify = app.getHttpAdapter().getInstance();
  registerWebhookRawBodyHook(fastify);

  registerRequestContext(fastify);

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  // Exact origins (site + port) from config/allowed-origins.ts, plus CORS_ORIGINS.
  const allowedOrigins = config.get<string[]>('cors.origins', resolveAllowedOrigins());
  app.enableCors(
    corsOptions(allowedOrigins, (origin) =>
      logger.warn(`CORS: rejected origin ${origin} (not in the allowlist)`),
    ),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ApiValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Plain WebSocket for the messaging gateway (`/ws`), on the HTTP server's port.
  app.useWebSocketAdapter(new WsAdapter(app));

  app.enableShutdownHooks();

  const document = buildOpenApiDocument(app);
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'openapi.json',
  });

  const host = config.get<string>('api.host', '0.0.0.0');
  const port = config.get<number>('api.port', 8000);
  await app.listen(port, host);
  logger.log(`Labs Food API listening on http://${host}:${port}`);
  logger.log(`CORS allowlist:  ${allowedOrigins.join(', ')}`);
  logger.log(`Swagger UI:     http://${host}:${port}/docs`);
  logger.log(`OpenAPI JSON:   http://${host}:${port}/openapi.json`);
}

void bootstrap();
