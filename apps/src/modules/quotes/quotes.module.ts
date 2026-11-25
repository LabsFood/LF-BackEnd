import { Module } from '@nestjs/common';

import { CalendarModule } from '../calendar/calendar.module';
import { MessagingModule } from '../messaging/messaging.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { ShoppingListsModule } from '../shopping-lists/shopping-lists.module';
import { UsersModule } from '../users/users.module';
import { ExpressDishesService } from './express-dishes.service';
import { QuoteOffersService } from './quote-offers.service';
import {
  AdminQuotesController,
  ChefQuotesController,
  ExpressDishesController,
  QuotesController,
} from './quotes.controller';
import { QuotesMailer } from './quotes.mailer';
import { QuotesService } from './quotes.service';

/**
 * Custom requests: a client asks, a batch cooker answers with an offer, and an
 * accepted offer becomes a prestation.
 */
@Module({
  imports: [
    UsersModule,
    MessagingModule,
    PlatformSettingsModule,
    CalendarModule,
    ShoppingListsModule,
  ],
  controllers: [
    QuotesController,
    ChefQuotesController,
    ExpressDishesController,
    AdminQuotesController,
  ],
  providers: [QuotesService, QuoteOffersService, ExpressDishesService, QuotesMailer],
})
export class QuotesModule {}
