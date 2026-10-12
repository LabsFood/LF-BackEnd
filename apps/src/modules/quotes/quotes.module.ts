import { Module } from '@nestjs/common';

import { MessagingModule } from '../messaging/messaging.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { UsersModule } from '../users/users.module';
import { QuoteOffersService } from './quote-offers.service';
import {
  AdminQuotesController,
  ChefQuotesController,
  QuotesController,
} from './quotes.controller';
import { QuotesMailer } from './quotes.mailer';
import { QuotesService } from './quotes.service';

/**
 * Custom requests: a client asks, a batch cooker answers with an offer, and an
 * accepted offer becomes a prestation.
 */
@Module({
  imports: [UsersModule, MessagingModule, PlatformSettingsModule],
  controllers: [QuotesController, ChefQuotesController, AdminQuotesController],
  providers: [QuotesService, QuoteOffersService, QuotesMailer],
})
export class QuotesModule {}
