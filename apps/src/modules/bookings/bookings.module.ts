import { Module } from '@nestjs/common';

import { CalendarModule } from '../calendar/calendar.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ShoppingListsModule } from '../shopping-lists/shopping-lists.module';
import { UsersModule } from '../users/users.module';
import { AdminBookingsController } from './admin-bookings.controller';
import { BookingDocumentsService } from './booking-documents.service';
import { BookingPhotosService } from './booking-photos.service';
import { BookingReschedulesService } from './booking-reschedules.service';
import { BookingWithdrawalsService } from './booking-withdrawals.service';
import { BookingsMailer } from './bookings.mailer';
import { BookingsService } from './bookings.service';
import { ChefBookingsController } from './chef-bookings.controller';
import { MeBookingsController } from './me-bookings.controller';

/** Bookings by audience: `/me/bookings`, `/chef/bookings`, `/admin/bookings`. */
@Module({
  imports: [UsersModule, ShoppingListsModule, CalendarModule, NotificationsModule],
  controllers: [MeBookingsController, ChefBookingsController, AdminBookingsController],
  providers: [
    BookingsService,
    BookingDocumentsService,
    BookingPhotosService,
    BookingReschedulesService,
    BookingWithdrawalsService,
    BookingsMailer,
  ],
  // Recettes lot 6: the grocery flow keeps the SHA-256 of the mandate PDF as proof.
  exports: [BookingDocumentsService],
})
export class BookingsModule {}
