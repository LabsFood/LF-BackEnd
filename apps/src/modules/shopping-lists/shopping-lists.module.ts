import { Module } from '@nestjs/common';

import { ShoppingListsService } from './shopping-lists.service';

@Module({
  providers: [ShoppingListsService],
  exports: [ShoppingListsService],
})
export class ShoppingListsModule {}
