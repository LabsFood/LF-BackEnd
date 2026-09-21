import 'reflect-metadata';

import helmet from '@fastify/helmet';
import { ConsoleLogger, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Http2ServerRequest } from 'node:http2';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { CLERK_WEBHOOK_PATH } from './auth/fastify-raw-body';
import { isOriginAllowed, resolveAllowedOrigins } from './config/allowed-origins';

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
  app.enableCors({
    origin: (origin: string | undefined, callback) => {
      if (isOriginAllowed(origin, allowedOrigins)) {
        callback(null, true);
        return;
      }
      logger.warn(`CORS: rejected origin ${origin} (not in the allowlist)`);
      callback(null, false);
    },
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Labs Food API')
    .setDescription(
      [
        "Lab's Food backend API (NestJS + Fastify).",
        '',
        '## Authentication',
        'Protected routes require "Authorization: Bearer <Clerk session JWT>".',
        'Sign-in is handled by the Next.js frontend via Clerk. Sign-up may go through the frontend',
        'or through this API\'s public "POST /auth/register"; both end with a Clerk session.',
        '',
        '## Roles (Postgres "users.role")',
        '- `client` — default after "POST /auth/register" or first "GET /me"',
        '- `chef` — kitchen / provider staff; set by "PATCH /me/chef-profile", inactive until vetted',
        '- `admin` — back-office; required for "/admin/*" routes. Never self-assignable',
        '',
        '## Sign-up flow (two forms)',
        '1. Form 1 → "POST /auth/register" (public) → creates the account, returns a sign-in ticket',
        '2. Frontend redeems the ticket via "signIn.create({ strategy: \'ticket\', ticket })" → session',
        '3. Form 2 → "PATCH /me/profile" (client) or "PATCH /me/chef-profile" (chef)',
        '   The route selects the role; the request body never carries one.',
        '4. Chefs stay "is_active: false" until an admin calls "PATCH /admin/chefs/:id/verification"',
        '',
        '## Admin flows',
        '- Promote users → "PATCH /admin/users/:id/role" (`:id` = Postgres uuid)',
        '- Provision accounts → "POST /admin/users" (requires real "CLERK_SECRET_KEY")',
        '',
        'See "docs/auth/clerk-integration-contract.md" for the full frontend ↔ backend contract.',
      ].join('\n'),
    )
    .setVersion('1.2.0')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description:
        'Clerk session JWT from the frontend (`getToken()`) or a dev session token.',
    })
    .addTag('auth', 'Public registration (no session required)')
    .addTag('users', 'Identity, profiles, and admin user management')
    .addTag('bookings', 'Client and admin booking operations')
    .addTag('catalog', 'Menus, meals, and formules')
    .addTag('quotes', 'Custom quote requests')
    .addTag('stats', 'Client and admin dashboards')
    .addTag('content-cms', 'Public and admin CMS content')
    .addTag('health', 'Liveness and readiness probes')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
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
