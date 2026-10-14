import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { ApiClerkAuthResponses } from '../../common/swagger/auth-responses';
import { TAGS } from '../../common/swagger/tags';
import { CalendarConnectionService } from './calendar-connection.service';
import { ConnectCalendarDto, SelectCalendarDto } from './dto/availability.dto';

const LINKED_EXAMPLE = {
  configured: true,
  connected: true,
  status: 'active',
  providerName: 'google',
  profileName: 'chef.marie@gmail.com',
  calendarId: 'cal_n23kjnwrw2_jsdfjksn234',
  lastError: null,
  calendars: [
    {
      id: 'cal_n23kjnwrw2_jsdfjksn234',
      name: 'chef.marie@gmail.com',
      primary: true,
      provider: 'google',
      profile: 'chef.marie@gmail.com',
    },
  ],
};

const UNAVAILABLE =
  'Calendar linking is not configured on this server (`CALENDAR_UNAVAILABLE`).';

@ApiTags(TAGS.chefBookings)
@ApiBearerAuth()
@Controller('chef/calendar')
@UseGuards(ClerkAuthGuard)
export class ChefCalendarController {
  constructor(private readonly calendars: CalendarConnectionService) {}

  @Get()
  @ApiOperation({
    summary: 'My linked calendar',
    description:
      '`connected: false` until one is linked. `status: revoked` means the access was ' +
      'withdrawn or lapsed: connect again. Prestations are written to `calendarId`, and ' +
      'its busy time is taken out of my availability.',
  })
  @ApiOkResponse({ description: 'The link.', example: LINKED_EXAMPLE })
  @ApiClerkAuthResponses()
  get(@CurrentClerkUser() user: ClerkUser) {
    return this.calendars.status(user.userId);
  }

  @Get('connect-url')
  @ApiOperation({
    summary: 'Link my calendar, step 1 of 3: where to send me',
    description:
      '1. This call answers a Cronofy `url`, valid 10 minutes.\n' +
      '2. Open it: the batch cooker picks Google, Outlook, Apple… and agrees. Cronofy ' +
      'sends them back to the agenda page with `code` and `state`.\n' +
      '3. That page calls `POST /chef/calendar/connect` with both, unchanged.',
  })
  @ApiOkResponse({
    description: 'Where to send the batch cooker.',
    example: { url: 'https://app-de.cronofy.com/oauth/authorize?response_type=code&…' },
  })
  @ApiServiceUnavailableResponse({ description: UNAVAILABLE })
  @ApiClerkAuthResponses()
  connectUrl(@CurrentClerkUser() user: ClerkUser) {
    return this.calendars.connectUrl(user.userId);
  }

  @Post('connect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Link my calendar, step 3 of 3: hand over the code',
    description:
      'The primary calendar that accepts events is picked; change it with `PATCH`. ' +
      'Linking again replaces the previous link.',
  })
  @ApiOkResponse({ description: 'The link.', example: LINKED_EXAMPLE })
  @ApiBadRequestResponse({
    description:
      '`INVALID_STATE`: expired, or made for someone else. `CALENDAR_CODE_REFUSED`: ' +
      'Cronofy did not accept the code.',
  })
  @ApiServiceUnavailableResponse({ description: UNAVAILABLE })
  @ApiClerkAuthResponses()
  connect(@CurrentClerkUser() user: ClerkUser, @Body() body: ConnectCalendarDto) {
    return this.calendars.connect(user.userId, body.code, body.state);
  }

  @Patch()
  @ApiOperation({ summary: 'Choose the calendar prestations are written to' })
  @ApiOkResponse({ description: 'The link.', example: LINKED_EXAMPLE })
  @ApiNotFoundResponse({ description: 'No calendar linked (`CALENDAR_NOT_CONNECTED`).' })
  @ApiUnprocessableEntityResponse({
    description: 'Not one of my calendars, or read-only (`CALENDAR_NOT_WRITABLE`).',
  })
  @ApiServiceUnavailableResponse({ description: UNAVAILABLE })
  @ApiClerkAuthResponses()
  select(@CurrentClerkUser() user: ClerkUser, @Body() body: SelectCalendarDto) {
    return this.calendars.selectCalendar(user.userId, body.calendarId);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Unlink my calendar',
    description: 'Events already written stay in it. Nothing happens if none is linked.',
  })
  @ApiNoContentResponse({ description: 'Unlinked.' })
  @ApiClerkAuthResponses()
  async disconnect(@CurrentClerkUser() user: ClerkUser): Promise<void> {
    await this.calendars.disconnect(user.userId);
  }
}
