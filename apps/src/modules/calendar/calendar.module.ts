import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { AvailabilityService } from './availability.service';
import { CalendarConnectionService } from './calendar-connection.service';
import { ChefAvailabilityController } from './chef-availability.controller';
import { ChefCalendarController } from './chef-calendar.controller';
import { PublicAvailabilityController } from './public-availability.controller';

/**
 * The batch cooker agenda: working hours, the free slots they leave, and the
 * calendar linked through Cronofy. Reads bookings straight from the database and
 * never imports BookingsModule, which imports this one.
 */
@Module({
  imports: [UsersModule],
  controllers: [
    ChefAvailabilityController,
    ChefCalendarController,
    PublicAvailabilityController,
  ],
  providers: [AvailabilityService, CalendarConnectionService],
  exports: [AvailabilityService, CalendarConnectionService],
})
export class CalendarModule {}
