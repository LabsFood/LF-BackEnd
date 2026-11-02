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

import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { ApiAdminAuthResponses } from '../../common/swagger/auth-responses';
import { ApiGeoResponses } from '../../common/swagger/geo-responses';
import { TAGS } from '../../common/swagger/tags';
import { ShoppingListsService } from '../shopping-lists/shopping-lists.service';
import { BookingsService } from './bookings.service';
import {
  AdminBookingsQueryDto,
  AdminUpdateBookingDto,
  NewBookingForClientDto,
} from './dto/bookings.dto';
import {
  ADMIN_DETAIL_EXAMPLE,
  ADMIN_ITEM_EXAMPLE,
  ApiBookingId,
  STATUS_HELP,
} from './swagger-examples';

/** Every booking on the platform. Admins only; every write is audited. */
@ApiTags(TAGS.adminBookings)
@ApiBearerAuth()
@Controller('admin/bookings')
@UseGuards(ClerkAuthGuard, AdminGuard)
export class AdminBookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly shoppingLists: ShoppingListsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List every booking',
    description:
      'Latest first, one page at a time. Filter by `clientId`, `chefId` (the batch ' +
      'cooker page), `status`, and `from` / `to` on the start.',
  })
  @ApiOkResponse({
    description: 'One page, with `meta` for the paging.',
    example: { data: [ADMIN_ITEM_EXAMPLE], meta: { page: 1, limit: 20, total: 1 } },
  })
  @ApiAdminAuthResponses()
  list(@CurrentClerkUser() user: ClerkUser, @Query() query: AdminBookingsQueryDto) {
    return this.bookings.listFor('admin', user.userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Open any booking' })
  @ApiBookingId()
  @ApiOkResponse({ description: 'The booking.', example: ADMIN_DETAIL_EXAMPLE })
  @ApiNotFoundResponse({ description: 'No booking with this id.' })
  @ApiAdminAuthResponses()
  detail(@CurrentClerkUser() user: ClerkUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.detailFor('admin', user.userId, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Book for a client',
    description:
      'Any client, any active offer. Support’s override: the time is **not** checked ' +
      'against the batch cooker’s availability, and the booking is audited. Created ' +
      '`pending`, confirmed by its payment.',
  })
  @ApiCreatedResponse({ description: 'The booking.', example: ADMIN_DETAIL_EXAMPLE })
  @ApiNotFoundResponse({ description: '`OFFER_NOT_FOUND` or `CLIENT_NOT_FOUND`.' })
  @ApiConflictResponse({ description: '`SAME_PERSON` or `CHEF_UNAVAILABLE`.' })
  @ApiUnprocessableEntityResponse({
    description: 'A past start, `FORMULE_UNAVAILABLE` or `MEAL_UNAVAILABLE`.',
  })
  @ApiGeoResponses()
  @ApiAdminAuthResponses()
  create(@CurrentClerkUser() user: ClerkUser, @Body() body: NewBookingForClientDto) {
    return this.bookings.create('admin', user.userId, body);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Change any booking',
    description:
      'Any field, any status, availability not checked; audited. Cancelling a paid ' +
      'booking does not refund it: refund by hand in Stripe.\n\n' +
      STATUS_HELP,
  })
  @ApiBookingId()
  @ApiOkResponse({ description: 'The booking.', example: ADMIN_DETAIL_EXAMPLE })
  @ApiNotFoundResponse({ description: 'No booking with this id.' })
  @ApiConflictResponse({ description: '`CHANGED_MEANWHILE`: reload and try again.' })
  @ApiGeoResponses()
  @ApiAdminAuthResponses()
  update(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AdminUpdateBookingDto,
  ) {
    return this.bookings.update('admin', user.userId, id, body);
  }

  @Post(':id/shopping-list/regenerate')
  @ApiOperation({
    summary: "Rebuild a booking's shopping list",
    description:
      'Recomputes the shopping list from the recipe versions the booking cooks from: ' +
      'each ingredient scaled to the portions booked, the same ingredient in the same ' +
      "unit added up. The batch cooker's corrections are kept.",
  })
  @ApiBookingId()
  @ApiCreatedResponse({
    description: 'The new shopping list, as stored: one line per ingredient and unit.',
    example: {
      id: '4b1d0c2e-7a51-4f0e-9a3b-2c8d1e6f7a90',
      bookingId: '9c3ebc99-9c0b-4ef8-bb6d-6bb9bd380a99',
      generatedAt: '2026-10-17T09:12:03.412Z',
      items: [
        {
          id: '0e7f6c51-3d2a-4b8e-9f10-5a6b7c8d9e01',
          shoppingListId: '4b1d0c2e-7a51-4f0e-9a3b-2c8d1e6f7a90',
          aisle: 'Fruits et légumes',
          name: 'Carottes',
          quantity: '800 g',
          qty: 800,
          unit: 'g',
          edited: false,
          removed: false,
        },
      ],
    },
  })
  @ApiNotFoundResponse({ description: 'No booking with this id.' })
  @ApiAdminAuthResponses()
  regenerateShoppingList(@Param('id', ParseUUIDPipe) id: string) {
    return this.shoppingLists.regenerateForBooking(id);
  }
}
