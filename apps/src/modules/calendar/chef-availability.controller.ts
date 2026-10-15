import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { ApiClerkAuthResponses } from '../../common/swagger/auth-responses';
import { TAGS } from '../../common/swagger/tags';
import { AvailabilityService } from './availability.service';
import { ChefSlotsQueryDto, ScheduleDto } from './dto/availability.dto';

const SCHEDULE_EXAMPLE = {
  weekly: [
    { id: '0b6f…', weekday: 0, startMinute: 540, endMinute: 780 },
    { id: '1c7a…', weekday: 2, startMinute: 840, endMinute: 1140 },
  ],
  exceptions: [
    {
      id: '2d8b…',
      date: '2026-12-24',
      kind: 'closed',
      startMinute: null,
      endMinute: null,
      reason: 'Réveillon',
    },
  ],
  version: 'k3Vq0Zb1xT2mN8aR',
  scheduled: true,
};

const NO_CHEF = 'No batch cooker page for this account (`NOT_A_CHEF`).';
const NOT_VERIFIED = 'The candidature is not approved yet (`CHEF_NOT_VERIFIED`).';

@ApiTags(TAGS.chefBookings)
@ApiBearerAuth()
@Controller('chef/availability')
@UseGuards(ClerkAuthGuard)
export class ChefAvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get()
  @ApiOperation({
    summary: 'My working hours',
    description:
      'The weekly template and the days off or extra ranges ahead, in minutes since ' +
      'midnight, Paris time (`540` = 9:00). `weekday` 0 is Monday. Send `version` ' +
      'back with the next save. `scheduled: false` means no hours are set yet.',
  })
  @ApiOkResponse({ description: 'The schedule.', example: SCHEDULE_EXAMPLE })
  @ApiNotFoundResponse({ description: NO_CHEF })
  @ApiForbiddenResponse({ description: NOT_VERIFIED })
  @ApiClerkAuthResponses()
  get(@CurrentClerkUser() user: ClerkUser) {
    return this.availability.schedule(user.userId);
  }

  @Put()
  @ApiOperation({
    summary: 'Replace my working hours',
    description:
      'Sends the whole schedule from today on; what is not in it is removed, and past ' +
      'days off stay as they were. A `closed` day takes the whole date off; an `extra` ' +
      'range adds to an open day. Clients can only book inside these hours, outside ' +
      'prestations and blocks. Ids are issued anew on every save: read them back. ' +
      'With the `version` read, a save from a stale tab is refused instead of erasing ' +
      'the other tab’s edits.',
  })
  @ApiOkResponse({ description: 'The schedule as saved.', example: SCHEDULE_EXAMPLE })
  @ApiUnprocessableEntityResponse({
    description:
      '`RANGE_INVALID`: a range ends before it starts. `SCHEDULE_OVERLAP`: two ranges ' +
      'of one day overlap. `SCHEDULE_CONFLICT`: a date is both closed and given extra ' +
      'hours. `details` names the day: `{weekday}` (0 is Monday) or `{date}`.',
  })
  @ApiConflictResponse({
    description: '`SCHEDULE_CHANGED`: saved elsewhere since this `version` was read.',
  })
  @ApiNotFoundResponse({ description: NO_CHEF })
  @ApiForbiddenResponse({ description: NOT_VERIFIED })
  @ApiClerkAuthResponses()
  replace(@CurrentClerkUser() user: ClerkUser, @Body() body: ScheduleDto) {
    return this.availability.replaceSchedule(user.userId, body);
  }

  @Get('slots')
  @ApiOperation({
    summary: 'Preview my free start times',
    description:
      'What a client would be offered for a prestation of `durationMinutes`: working ' +
      'hours minus prestations and blocks, on a 30-minute grid, 31 days at most. ' +
      '`scheduled: false` means no working hours are set yet.',
  })
  @ApiOkResponse({
    description: 'The free start times.',
    example: { scheduled: true, slots: ['2026-10-19T07:00:00.000Z'] },
  })
  @ApiUnprocessableEntityResponse({ description: 'Window empty, past or over 31 days.' })
  @ApiClerkAuthResponses()
  slots(@CurrentClerkUser() user: ClerkUser, @Query() query: ChefSlotsQueryDto) {
    return this.availability.chefSlots(user.userId, query);
  }
}
