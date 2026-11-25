import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { AgendaService } from './agenda.service';
import { AvailabilityService } from './availability.service';
import {
  ChefCalendarFeedController,
  PublicCalendarFeedController,
} from './calendar-feed.controller';
import { CalendarFeedService } from './calendar-feed.service';
import { ChefAgendaController } from './chef-agenda.controller';
import { ChefAvailabilityController } from './chef-availability.controller';
import { PublicAvailabilityController } from './public-availability.controller';

/**
 * The batch cooker agenda: working hours, blocks, and the free slots they leave.
 * Reads bookings and quotes straight from the database and never imports
 * BookingsModule or QuotesModule, which import this one.
 */
@Module({
  imports: [UsersModule],
  controllers: [
    ChefAgendaController,
    ChefAvailabilityController,
    ChefCalendarFeedController,
    PublicAvailabilityController,
    PublicCalendarFeedController,
  ],
  providers: [AgendaService, AvailabilityService, CalendarFeedService],
  exports: [AvailabilityService, CalendarFeedService],
})
export class CalendarModule {}
