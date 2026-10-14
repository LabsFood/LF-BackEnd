import { Module } from '@nestjs/common';

import { CalendarModule } from '../calendar/calendar.module';
import { ShoppingListsModule } from '../shopping-lists/shopping-lists.module';
import { UsersModule } from '../users/users.module';
import { AdminBookingsController } from './admin-bookings.controller';
import { BookingPhotosService } from './booking-photos.service';
import { BookingsController } from './bookings.controller';
import { BookingsMailer } from './bookings.mailer';
import { BookingsService } from './bookings.service';
import { ChefBookingsController } from './chef-bookings.controller';
import { MeBookingsController } from './me-bookings.controller';

/**
 * Bookings by audience: `/me/bookings`, `/chef/bookings`, `/admin/bookings`. The
 * old `/bookings/…` routes stay, deprecated, for one release.
 */
@Module({
  imports: [UsersModule, ShoppingListsModule, CalendarModule],
  controllers: [
    MeBookingsController,
    ChefBookingsController,
    AdminBookingsController,
    BookingsController,
  ],
  providers: [BookingsService, BookingPhotosService, BookingsMailer],
})
export class BookingsModule {}
