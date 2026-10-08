import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { AdminConversationsController } from './admin-conversations.controller';
import { MeConversationsController } from './me-conversations.controller';
import { MessagingGateway } from './messaging.gateway';
import { MessagingAdminService } from './services/messaging-admin.service';
import { MessagingEventsService } from './services/messaging-events.service';
import { MessagingNotifierCron } from './services/messaging-notifier.cron';
import { MessagingRateLimiter } from './services/messaging-rate-limiter';
import { MessagingStorageService } from './services/messaging-storage.service';
import { MessagingService } from './services/messaging.service';

/**
 * Conversations: client ↔ batch cooker (one per pair) and user ↔ team (support).
 * REST to read and write, a listen-only WebSocket for what arrives meanwhile.
 */
@Module({
  imports: [UsersModule],
  controllers: [MeConversationsController, AdminConversationsController],
  providers: [
    MessagingService,
    MessagingAdminService,
    MessagingStorageService,
    MessagingRateLimiter,
    MessagingEventsService,
    MessagingNotifierCron,
    MessagingGateway,
  ],
  // `ensurePair` is the hook for the booking flow, once it confirms bookings.
  exports: [MessagingService],
})
export class MessagingModule {}
