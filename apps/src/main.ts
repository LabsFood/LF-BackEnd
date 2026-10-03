import 'reflect-metadata';

import helmet from '@fastify/helmet';
import { ConsoleLogger, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Http2ServerRequest } from 'node:http2';
import { SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { CLERK_WEBHOOK_PATH } from './auth/fastify-raw-body';
import { isOriginAllowed, resolveAllowedOrigins } from './config/allowed-origins';
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
 */
const jsonLogging =
  (process.env.LOG_JSON ?? String(process.env.ENVIRONMENT === 'production')) === 'true';
const logLevel =
  process.env.LOG_LEVEL ?? (process.env.ENVIRONMENT === 'production' ? 'info' : 'debug');

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      // Access logs (method, path, status, duration) with a request id that also
      // lands in `audit_log.request_id`, so a Railway line and a database row can
      // be joined when debugging one candidature.
      logger: jsonLogging ? { level: logLevel } : false,
      // Honour an inbound id from the proxy so a trace survives across services.
      genReqId: (req: IncomingMessage | Http2ServerRequest) =>
        (req.headers['x-request-id'] as string | undefined)?.slice(0, 64) ?? randomUUID(),
      trustProxy: true,
    }),
    {
      bufferLogs: true,
      logger: new ConsoleLogger({ json: jsonLogging, colors: !jsonLogging }),
    },
  );
  const logger = new Logger('Bootstrap');
  const config = app.get(ConfigService);

  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('preParsing', async (request, _reply, payload) => {
    if (!request.url?.startsWith(CLERK_WEBHOOK_PATH)) {
      return payload;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of payload) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const rawBody = Buffer.concat(chunks);
    (request as { rawBody?: Buffer }).rawBody = rawBody;
    return rawBody;
  });

  fastify.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  // Exact origins (site + port) from config/allowed-origins.ts, plus CORS_ORIGINS.
  const allowedOrigins = config.get<string[]>('cors.origins', resolveAllowedOrigins());
  app.enableCors(
    corsOptions(allowedOrigins, (origin) =>
      logger.warn(`CORS: rejected origin ${origin} (not in the allowlist)`),
    )
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

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
