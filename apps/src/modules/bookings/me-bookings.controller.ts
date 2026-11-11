import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
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
  ApiParam,
  ApiProduces,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';

import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { ApiClerkAuthResponses } from '../../common/swagger/auth-responses';
import { ICS_EXAMPLE } from '../../common/swagger/ics-example';
import { ApiGeoResponses } from '../../common/swagger/geo-responses';
import { TAGS } from '../../common/swagger/tags';
import { CalendarFeedService } from '../calendar/calendar-feed.service';
import { BookingDocumentsService } from './booking-documents.service';
import { BookingReschedulesService } from './booking-reschedules.service';
import { BookingWithdrawalsService } from './booking-withdrawals.service';
import { BookingsService } from './bookings.service';
import type { BookingDocumentKind } from './bookings.views';
import {
  BookingsQueryDto,
  ContractConsentsDto,
  NewBookingDto,
  ReplaceMealDto,
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
    private readonly withdrawals: BookingWithdrawalsService,
    private readonly documents: BookingDocumentsService,
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

  @Get(':id/documents/:kind')
  @ApiOperation({
    summary: 'Download a document of my booking’s contract',
    description:
      'The documents listed in the booking’s `documents` (CGV art. 2.4): `cgv`, the ' +
      'CGV accepted, as published; `withdrawal-form`, the withdrawal form pre-filled; ' +
      '`debours-mandate`, the particular débours mandate, built on demand when the ' +
      'mandate box was ticked.',
  })
  @ApiBookingId()
  @ApiParam({ name: 'kind', enum: ['cgv', 'withdrawal-form', 'debours-mandate'] })
  @ApiProduces('application/pdf')
  @ApiOkResponse({ description: 'The PDF, as an attachment.' })
  @ApiNotFoundResponse({
    description:
      '`BOOKING_NOT_FOUND` (no such booking, or not mine) or `DOCUMENT_NOT_FOUND` (not ' +
      'one of this booking’s documents).',
  })
  @ApiClerkAuthResponses()
  async document(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('kind', new ParseEnumPipe(['cgv', 'withdrawal-form', 'debours-mandate']))
    kind: BookingDocumentKind,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { filename, bytes } = await this.documents.file(user.userId, id, kind);
    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('Cache-Control', 'private, no-store');
    return bytes;
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
    description:
      'A past start, `FORMULE_UNAVAILABLE`, `MEAL_UNAVAILABLE`, or ' +
      '`CONTRACT_CONSENT_REQUIRED` (from 2026-11-21): `missing` lists the boxes ' +
      'still to tick (`CGV`, `DEBOURS_MANDATE`, `EARLY_EXECUTION`) and `version` the ' +
      'CGV version to read them in.',
  })
  @ApiGeoResponses()
  @ApiClerkAuthResponses()
  create(@CurrentClerkUser() user: ClerkUser, @Body() body: NewBookingDto) {
    return this.bookings.create('client', user.userId, body);
  }

  @Post(':id/consents')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Tick the booking boxes of a pending booking',
    description:
      'For a booking a batch cooker or Lab’s Food made for me, or one whose time or ' +
      'shopping changed since: payment is refused (`CONTRACT_CONSENT_REQUIRED`, 409) ' +
      'until every box it needs is ticked. Boxes already ticked are kept.',
  })
  @ApiBookingId()
  @ApiOkResponse({ description: 'The booking.', example: CLIENT_DETAIL })
  @ApiNotFoundResponse({
    description: '`BOOKING_NOT_FOUND`: no such booking, or not mine.',
  })
  @ApiConflictResponse({
    description: '`BOOKING_LOCKED` (not `pending`) or `CHANGED_MEANWHILE`.',
  })
  @ApiUnprocessableEntityResponse({
    description: '`CONTRACT_CONSENT_REQUIRED`: a box it needs is still missing.',
  })
  @ApiClerkAuthResponses()
  consent(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ContractConsentsDto,
  ) {
    return this.bookings.consent(user.userId, id, body);
  }

  @Post(':id/withdrawal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Withdraw from a booking (« Se rétracter »)',
    description:
      'The right of withdrawal (CGV art. 15): 14 days from the contract’s conclusion, ' +
      'without a reason. This is the « Confirmer la rétractation » step: the booking is ' +
      '`cancelled` at once and an acknowledgement email goes out with the declaration, ' +
      'its date and time. What is refundable comes back within 14 days, by the means ' +
      'used to pay. The booking detail’s `withdrawal` says whether it is `open`, until ' +
      'when, and what it costs.\n\n' +
      'Nothing is owed unless the client asked to start early: then 20 % of the price ' +
      'once the shopping is done, or a share Lab’s Food sets while cooking. A ' +
      'prestation fully performed at the client’s request can no longer be withdrawn from.',
  })
  @ApiBookingId()
  @ApiOkResponse({ description: 'The booking, `cancelled`.', example: CLIENT_DETAIL })
  @ApiNotFoundResponse({
    description: '`BOOKING_NOT_FOUND`: no such booking, or not mine.',
  })
  @ApiConflictResponse({
    description:
      '`WITHDRAWAL_NOT_CONCLUDED` (still `pending`: cancel it instead), ' +
      '`WITHDRAWAL_ALREADY_SENT`, `BOOKING_CANCELLED`, `WITHDRAWAL_PERIOD_OVER`, ' +
      '`WITHDRAWAL_EXECUTED` or `CHANGED_MEANWHILE`.',
  })
  @ApiClerkAuthResponses()
  withdraw(@CurrentClerkUser() user: ClerkUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.withdrawals.withdraw(user.userId, id);
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
  @ApiGeoResponses()
  @ApiClerkAuthResponses()
  update(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateBookingDto,
  ) {
    return this.bookings.update('client', user.userId, id, body);
  }

  @Post(':id/meals/replace')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Replace a dish that clashes with my allergies',
    description:
      'After an allergy declared once the menu was validated, `allergyConflicts` lists ' +
      'the dishes to replace. Any status before delivery, a frozen menu included; only ' +
      'a dish in conflict, and only for a safe one.',
  })
  @ApiBookingId()
  @ApiOkResponse({ description: 'The booking.', example: CLIENT_DETAIL })
  @ApiNotFoundResponse({ description: 'No such booking, or not mine.' })
  @ApiConflictResponse({ description: '`BOOKING_LOCKED`: the prestation is over.' })
  @ApiUnprocessableEntityResponse({
    description:
      '`VALIDATION_FAILED` (the dish is not in conflict, or already on the menu), ' +
      '`MEAL_UNAVAILABLE`, `ALLERGENS_UNVERIFIED` or `ALLERGEN_CONFLICT` for the new dish.',
  })
  @ApiClerkAuthResponses()
  replaceMeal(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReplaceMealDto,
  ) {
    return this.bookings.replaceConflictingMeal('client', user.userId, id, body);
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
