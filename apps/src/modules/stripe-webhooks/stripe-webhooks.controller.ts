import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiExcludeController, ApiTags } from '@nestjs/swagger';

import {
  getWebhookRawBody,
  type RawBodyFastifyRequest,
} from '../../auth/fastify-raw-body';
import { StripeWebhooksService } from './stripe-webhooks.service';

@ApiTags('webhooks')
@ApiExcludeController()
@Controller('webhooks')
export class StripeWebhooksController {
  constructor(private readonly stripeWebhooks: StripeWebhooksService) {}

  @Post('stripe')
  @HttpCode(200)
  async handleStripeWebhook(
    @Req() req: RawBodyFastifyRequest,
    @Headers('stripe-signature') signature?: string,
  ): Promise<{ received: true }> {
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header.');
    }

    let rawBody: string;
    try {
      rawBody = getWebhookRawBody(req);
    } catch {
      throw new BadRequestException('Missing raw webhook body.');
    }

    try {
      await this.stripeWebhooks.verifyAndHandle(rawBody, signature);
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
