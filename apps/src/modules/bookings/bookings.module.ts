import { Module } from '@nestjs/common';

import { ShoppingListsModule } from '../shopping-lists/shopping-lists.module';
import { UsersModule } from '../users/users.module';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

@Module({
  imports: [UsersModule, ShoppingListsModule],
  controllers: [BookingsController],
  providers: [BookingsService],
})
export class BookingsModule {}
