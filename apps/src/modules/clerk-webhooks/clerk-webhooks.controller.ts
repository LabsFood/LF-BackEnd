import {
  BadRequestException,
  Controller,
  HttpCode,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiExcludeController, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import {
  getWebhookRawBody,
  type RawBodyFastifyRequest,
} from '../../auth/fastify-raw-body';
import { ClerkWebhooksService } from './clerk-webhooks.service';

function buildWebhookHeaders(req: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const part of value) headers.append(name, part);
    } else {
      headers.set(name, value);
    }
  }
  return headers;
}

@ApiTags('webhooks')
@ApiExcludeController()
@Controller('webhooks')
export class ClerkWebhooksController {
  constructor(private readonly clerkWebhooks: ClerkWebhooksService) {}

  @Post('clerk')
  @HttpCode(200)
  async handleClerkWebhook(
    @Req() req: RawBodyFastifyRequest,
  ): Promise<{ received: true }> {
    let rawBody: string;
    try {
      rawBody = getWebhookRawBody(req);
    } catch {
      throw new BadRequestException('Missing raw webhook body.');
    }

    try {
      await this.clerkWebhooks.verifyAndHandle(rawBody, buildWebhookHeaders(req));
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : 'Webhook verification failed';
      throw new BadRequestException(message);
    }

    return { received: true };
  }
}
