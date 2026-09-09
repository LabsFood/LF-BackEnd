import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { ClerkWebhooksController } from './clerk-webhooks.controller';
import { ClerkWebhooksService } from './clerk-webhooks.service';

@Module({
  imports: [UsersModule],
  controllers: [ClerkWebhooksController],
  providers: [ClerkWebhooksService],
})
export class ClerkWebhooksModule {}
