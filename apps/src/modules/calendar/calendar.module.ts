import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { AvailabilityService } from './availability.service';
import { ChefAvailabilityController } from './chef-availability.controller';
import { PublicAvailabilityController } from './public-availability.controller';

/**
 * The batch cooker agenda: working hours and the free slots they leave. Reads
 * bookings straight from the database and never imports BookingsModule, which
 * imports this one.
 */
@Module({
  imports: [UsersModule],
  controllers: [ChefAvailabilityController, PublicAvailabilityController],
  providers: [AvailabilityService],
  exports: [AvailabilityService],
})
export class CalendarModule {}
