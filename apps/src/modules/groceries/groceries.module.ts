import { Module } from '@nestjs/common';

import { BookingsModule } from '../bookings/bookings.module';
import { ChefOnboardingModule } from '../chef-onboarding/chef-onboarding.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import {
  AdminGroceriesController,
  BrevoWebhookController,
  GroceriesController,
} from './groceries.controller';
import { GroceriesCron } from './groceries.cron';
import { GroceriesService } from './groceries.service';
import { GroceriesStripe } from './groceries-stripe';

/**
 * Recettes lot 6: the groceries paid apart by card, under the débours mandate. The
 * Stripe webhooks reach it through `StripeWebhooksModule`, which imports it.
 */
@Module({
  imports: [UsersModule, NotificationsModule, BookingsModule, ChefOnboardingModule],
  controllers: [GroceriesController, AdminGroceriesController, BrevoWebhookController],
  providers: [GroceriesService, GroceriesStripe, GroceriesCron],
  exports: [GroceriesService],
})
export class GroceriesModule {}
