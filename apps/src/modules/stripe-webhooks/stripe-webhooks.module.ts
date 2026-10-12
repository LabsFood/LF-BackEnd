import { Module } from '@nestjs/common';

import { PaymentsModule } from '../payments/payments.module';
import { StripeWebhooksController } from './stripe-webhooks.controller';
import { StripeWebhooksService } from './stripe-webhooks.service';

@Module({
  imports: [PaymentsModule],
  controllers: [StripeWebhooksController],
  providers: [StripeWebhooksService],
})
export class StripeWebhooksModule {}
