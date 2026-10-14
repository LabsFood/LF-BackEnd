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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
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
import { BookingsService } from './bookings.service';
import { BookingsQueryDto, NewBookingDto, UpdateBookingDto } from './dto/bookings.dto';
import {
  ApiBookingId,
  CLIENT_DETAIL_EXAMPLE as CLIENT_DETAIL,
  CLIENT_ITEM_EXAMPLE as CLIENT_ITEM,
  STATUS_HELP,
} from './swagger-examples';

/** The signed-in client's own bookings. Anyone else's is a 404. */
@ApiTags(TAGS.bookings)
@ApiBearerAuth()
@Controller('me/bookings')
@UseGuards(ClerkAuthGuard)
export class MeBookingsController {
  constructor(private readonly bookings: BookingsService) {}

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
      '`SLOT_UNAVAILABLE`, `SAME_PERSON`, or `COMMISSION_UNPAID` (the batch cooker ' +
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
}
