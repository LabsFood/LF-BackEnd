import { Module } from '@nestjs/common';

import { BookingsModule } from '../bookings/bookings.module';
import { GroceriesModule } from '../groceries/groceries.module';
import { PaymentsModule } from '../payments/payments.module';
import { StripeWebhooksController } from './stripe-webhooks.controller';
import { StripeWebhooksService } from './stripe-webhooks.service';

@Module({
  imports: [PaymentsModule, GroceriesModule, BookingsModule],
  controllers: [StripeWebhooksController],
  providers: [StripeWebhooksService],
})
export class StripeWebhooksModule {}
