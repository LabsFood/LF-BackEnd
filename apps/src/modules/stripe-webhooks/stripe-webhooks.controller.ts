import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  InternalServerErrorException,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiExcludeController, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import {
  getWebhookRawBody,
  type RawBodyFastifyRequest,
} from '../../auth/fastify-raw-body';
import { StripeWebhooksService } from './stripe-webhooks.service';

@ApiTags('webhooks')
@ApiExcludeController()
// Stripe retries in bursts from a few IPs; the signature is the gate here.
@SkipThrottle({ global: true })
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
      // The event was genuine but its handler failed (logged with the event id): a 500
      // so Stripe retries, without echoing the internal error back to Stripe.
      throw new InternalServerErrorException({
        code: 'WEBHOOK_HANDLER_FAILED',
        message: 'The event could not be processed; Stripe will retry it.',
      });
    }

    return { received: true };
  }
}
