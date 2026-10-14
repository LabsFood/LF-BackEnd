import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

import { TAGS } from '../../common/swagger/tags';
import { AvailabilityService } from './availability.service';
import { PublicSlotsQueryDto } from './dto/availability.dto';

/** No token: what a visitor sees before booking. Free start times only, never why. */
@Controller('chefs')
// Public and unauthenticated: rate-limited per route and IP.
@UseGuards(ThrottlerGuard)
@Throttle({ register: { limit: 30, ttl: 60_000 } })
export class PublicAvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get(':id/availability')
  @ApiTags(TAGS.catalog)
  @ApiOperation({
    summary: 'When can I book this batch cooker?',
    description:
      'Free start times for one of their service offers, between `from` and `to` (31 ' +
      'days at most), on a 30-minute grid: working hours minus their prestations and ' +
      'their calendar busy time. Never says what makes a time busy.\n\n' +
      '`scheduled: false`: no working hours set; any time not taken can be asked for ' +
      '(`POST /me/bookings` still checks it). Public: no token needed.',
  })
  @ApiParam({ name: 'id', description: 'The batch cooker page id.' })
  @ApiOkResponse({
    description: 'The free start times.',
    example: {
      durationMinutes: 180,
      scheduled: true,
      slots: ['2026-10-19T07:00:00.000Z', '2026-10-19T07:30:00.000Z'],
    },
  })
  @ApiNotFoundResponse({
    description: 'No such offer from an approved batch cooker online.',
  })
  @ApiUnprocessableEntityResponse({ description: 'Window empty, past or over 31 days.' })
  slots(@Param('id', ParseUUIDPipe) chefId: string, @Query() query: PublicSlotsQueryDto) {
    return this.availability.publicSlots(chefId, query);
  }
}
