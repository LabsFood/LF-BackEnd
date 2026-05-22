import 'reflect-metadata';

import helmet from '@fastify/helmet';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false, trustProxy: true }),
    { bufferLogs: true },
  );
  const logger = new Logger('Bootstrap');
  const config = app.get(ConfigService);

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
    .setDescription('Home massage booking backend (NestJS + Fastify).')
    .setVersion('0.1.0')
    .addBearerAuth()
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
