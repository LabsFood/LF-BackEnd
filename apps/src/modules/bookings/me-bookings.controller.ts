import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';

import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { ApiClerkAuthResponses } from '../../common/swagger/auth-responses';
import { ICS_EXAMPLE } from '../../common/swagger/ics-example';
import { TAGS } from '../../common/swagger/tags';
import { CalendarFeedService } from '../calendar/calendar-feed.service';
import { BookingReschedulesService } from './booking-reschedules.service';
import { BookingsService } from './bookings.service';
import {
  BookingsQueryDto,
  NewBookingDto,
  RescheduleAnswerDto,
  RescheduleDto,
  UpdateBookingDto,
} from './dto/bookings.dto';
import {
  ApiBookingId,
  CLIENT_DETAIL_EXAMPLE as CLIENT_DETAIL,
  CLIENT_ITEM_EXAMPLE as CLIENT_ITEM,
  RESCHEDULE_DECIDE_CONFLICTS,
  RESCHEDULE_EXAMPLE,
  RESCHEDULE_HELP,
  RESCHEDULE_PROPOSE_CONFLICTS,
  STATUS_HELP,
} from './swagger-examples';

/** The signed-in client's own bookings. Anyone else's is a 404. */
@ApiTags(TAGS.bookings)
@ApiBearerAuth()
@Controller('me/bookings')
@UseGuards(ClerkAuthGuard)
export class MeBookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly feeds: CalendarFeedService,
    private readonly reschedules: BookingReschedulesService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List my bookings',
    description:
      'Latest first, one page at a time. Filter with `status`, and `from` / `to` on the ' +
      'start: `?status=confirmed&from=2026-10-01T00:00:00Z&page=2`.',
  })
  @ApiOkResponse({
    description: 'One page, with `meta` for the paging.',
    example: { data: [CLIENT_ITEM], meta: { page: 1, limit: 20, total: 1 } },
  })
  @ApiClerkAuthResponses()
  list(@CurrentClerkUser() user: ClerkUser, @Query() query: BookingsQueryDto) {
    return this.bookings.listFor('client', user.userId, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Open one of my bookings',
    description:
      'With its dishes (no recipe: it comes with the recipe sheet after the ' +
      'prestation), the photos the batch cooker took, and `chefCesu`, the number to ' +
      'add the batch cooker on a CESU issuer’s portal before paying.',
  })
  @ApiBookingId()
  @ApiOkResponse({ description: 'The booking.', example: CLIENT_DETAIL })
  @ApiNotFoundResponse({ description: 'No such booking, or not mine.' })
  @ApiClerkAuthResponses()
  detail(@CurrentClerkUser() user: ClerkUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.detailFor('client', user.userId, id);
  }

  @Get(':id/calendar.ics')
  @ApiOperation({
    summary: 'Add one of my bookings to my calendar',
    description:
      'The prestation as an `.ics` file, to open in Google, Apple or Outlook. A later ' +
      'download of the same booking updates the same event.',
  })
  @ApiBookingId()
  @ApiProduces('text/calendar')
  @ApiOkResponse({
    description: 'iCalendar (RFC 5545), as an attachment.',
    content: { 'text/calendar': { schema: { type: 'string' }, example: ICS_EXAMPLE } },
  })
  @ApiNotFoundResponse({
    description: '`BOOKING_NOT_FOUND`: no such booking, or not mine.',
  })
  @ApiClerkAuthResponses()
  async calendarFile(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { filename, body } = await this.feeds.bookingFile(user.userId, id);
    reply
      .header('Content-Type', 'text/calendar; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('Cache-Control', 'private, no-store');
    return body;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Book a batch cooker',
    description:
      'Creates a `pending` booking: priced here (the formule’s price when one is ' +
      'chosen, otherwise the offer’s), ending after the offer’s duration, with the ' +
      'recipes of its dishes pinned. The time must be free (`GET ' +
      '/chefs/{id}/availability`). Paying it is what confirms it; unpaid, it holds the ' +
      'slot 72 h.',
  })
  @ApiCreatedResponse({ description: 'The booking.', example: CLIENT_DETAIL })
  @ApiNotFoundResponse({ description: '`OFFER_NOT_FOUND`.' })
  @ApiConflictResponse({
    description:
      '`SLOT_UNAVAILABLE`, `SAME_PERSON`, or `CHEF_UNAVAILABLE` (the batch cooker ' +
      'cannot take new work right now).',
  })
  @ApiUnprocessableEntityResponse({
    description: 'A past start, `FORMULE_UNAVAILABLE` or `MEAL_UNAVAILABLE`.',
  })
  @ApiClerkAuthResponses()
  create(@CurrentClerkUser() user: ClerkUser, @Body() body: NewBookingDto) {
    return this.bookings.create('client', user.userId, body);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Change or cancel one of my bookings',
    description:
      'The details (time, dishes, persons, address, notes) while it is `pending`; a new ' +
      'time must be free. `status`: `cancelled`, or `completed` once delivered.\n\n' +
      STATUS_HELP,
  })
  @ApiBookingId()
  @ApiOkResponse({ description: 'The booking.', example: CLIENT_DETAIL })
  @ApiNotFoundResponse({ description: 'No such booking, or not mine.' })
  @ApiConflictResponse({
    description:
      '`BOOKING_LOCKED`, `INVALID_TRANSITION`, `BOOKING_PAID`, `BOOKING_STARTED`, ' +
      '`SLOT_UNAVAILABLE` or `CHANGED_MEANWHILE`.',
  })
  @ApiClerkAuthResponses()
  update(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateBookingDto,
  ) {
    return this.bookings.update('client', user.userId, id, body);
  }

  @Post(':id/reschedule')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Propose a new time', description: RESCHEDULE_HELP })
  @ApiBookingId()
  @ApiCreatedResponse({ description: 'The proposal.', example: RESCHEDULE_EXAMPLE })
  @ApiNotFoundResponse({
    description: '`BOOKING_NOT_FOUND`: no such booking, or not mine.',
  })
  @ApiConflictResponse({ description: RESCHEDULE_PROPOSE_CONFLICTS })
  @ApiClerkAuthResponses()
  propose(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RescheduleDto,
  ) {
    return this.reschedules.propose('client', user.userId, id, body.startsAt);
  }

  @Patch(':id/reschedule')
  @ApiOperation({
    summary: 'Answer a new time',
    description:
      '`accepted` moves the prestation; `declined` keeps it; `withdrawn` takes back ' +
      'my own proposal.\n\n' +
      RESCHEDULE_HELP,
  })
  @ApiBookingId()
  @ApiOkResponse({
    description: 'The proposal, answered.',
    example: { ...RESCHEDULE_EXAMPLE, status: 'accepted' },
  })
  @ApiNotFoundResponse({
    description:
      '`RESCHEDULE_NOT_FOUND`: no new time waits. Or ' +
      '`BOOKING_NOT_FOUND`: no such booking, or not mine.',
  })
  @ApiConflictResponse({ description: RESCHEDULE_DECIDE_CONFLICTS })
  @ApiClerkAuthResponses()
  decide(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RescheduleAnswerDto,
  ) {
    return this.reschedules.decide('client', user.userId, id, body.decision);
  }
}
