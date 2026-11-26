import { Module } from '@nestjs/common';

import { MessagingModule } from '../messaging/messaging.module';
import { ShoppingListsService } from './shopping-lists.service';

@Module({
  imports: [MessagingModule],
  providers: [ShoppingListsService],
  exports: [ShoppingListsService],
})
export class ShoppingListsModule {}
