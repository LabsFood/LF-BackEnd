import 'reflect-metadata';

import helmet from '@fastify/helmet';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { CLERK_WEBHOOK_PATH } from './auth/fastify-raw-body';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false, trustProxy: true }),
    { bufferLogs: true },
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

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  app.enableCors({
    origin: config.get<string[]>('cors.origins', ['http://localhost:3000']),
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
        'Sign-in and sign-up are handled by the Next.js frontend via Clerk; this API verifies tokens and owns application data.',
        '',
        '## Roles (Postgres "users.role")',
        '- `client` — default after first "GET /me"',
        '- `chef` — kitchen / provider staff',
        '- `admin` — back-office; required for "/admin/*" routes',
        '',
        '## Key flows',
        '1. Frontend obtains Clerk JWT → "GET /me" upserts user and returns role',
        '2. Admin promotes users → "PATCH /admin/users/:id/role" (`:id` = Postgres uuid)',
        '3. Admin provisions accounts → "POST /admin/users" (requires real "CLERK_SECRET_KEY")',
        '',
        'See "docs/auth/clerk-integration-contract.md" for the full frontend ↔ backend contract.',
      ].join('\n'),
    )
    .setVersion('1.2.0')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'Clerk session JWT from the frontend (`getToken()`) or a dev session token.',
    })
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
  logger.log(`Swagger UI:     http://${host}:${port}/docs`);
  logger.log(`OpenAPI JSON:   http://${host}:${port}/openapi.json`);
}

void bootstrap();
