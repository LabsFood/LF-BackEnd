import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiNotImplementedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import {
  ApiAdminAuthResponses,
  ApiClerkAuthResponses,
} from '../../common/swagger/auth-responses';
import { TAGS } from '../../common/swagger/tags';
import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { ShoppingListsService } from '../shopping-lists/shopping-lists.service';
import { BookingsService } from './bookings.service';
import { BookingReadDto } from './dto/booking-read.dto';
import { CreateBookingDto } from './dto/create-booking.dto';

const SHOPPING_LIST = {
  id: 'f5eebc99-9c0b-4ef8-bb6d-6bb9bd380a66',
  bookingId: '7b1ebc99-9c0b-4ef8-bb6d-6bb9bd380a88',
  generatedAt: '2026-09-22T07:00:00.000Z',
  items: [
    {
      id: 'a6eebc99-9c0b-4ef8-bb6d-6bb9bd380a77',
      shoppingListId: 'f5eebc99-9c0b-4ef8-bb6d-6bb9bd380a66',
      aisle: 'boucherie',
      name: 'Cuisses de poulet',
      quantity: '8 pièces',
    },
  ],
};

const BOOKING_DETAIL = {
  id: '7b1ebc99-9c0b-4ef8-bb6d-6bb9bd380a88',
  reference: 'BK-2026-0105',
  clientId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  chefProfileId: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
  startsAt: '2026-10-02T09:00:00.000Z',
  endsAt: '2026-10-02T12:00:00.000Z',
  status: 'confirmed',
  priceCents: 9900,
  currency: 'EUR',
  bookingMeals: [
    {
      bookingId: '7b1ebc99-9c0b-4ef8-bb6d-6bb9bd380a88',
      mealId: 'd3eebc99-9c0b-4ef8-bb6d-6bb9bd380a44',
      portions: 4,
      meal: { id: 'd3eebc99-9c0b-4ef8-bb6d-6bb9bd380a44', name: 'Poulet yassa' },
    },
  ],
  shoppingList: SHOPPING_LIST,
};

const ApiBookingIdParam = () =>
  ApiParam({
    name: 'id',
    description: 'The booking id.',
    example: '7b1ebc99-9c0b-4ef8-bb6d-6bb9bd380a88',
  });

@ApiBearerAuth()
@Controller('bookings')
@UseGuards(ClerkAuthGuard)
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly shoppingLists: ShoppingListsService,
  ) {}

  @Get()
  @UseGuards(AdminGuard)
  @ApiTags(TAGS.adminBookings)
  @ApiOperation({
    summary: 'Admin: list every bookings',
    description:
      'Admin only. Returns every booking in the database for internal/admin tooling; ' +
      'All bookings, earliest first, not paginated. Meant for the back office, but ' +
      '**today any signed-in account can call it**'
  })
  @ApiOkResponse({
    type: BookingReadDto,
    isArray: true,
    description: 'The bookings.',
  })
  @ApiAdminAuthResponses()
  async list(): Promise<BookingReadDto[]> {
    const rows = await this.bookings.list();
    return rows.map((row) => BookingReadDto.fromEntity(row));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiTags(TAGS.bookings)
  @ApiOperation({
    summary: 'Book a batch cooker (not available yet)',
    description:
      '**Not built yet: always answers `501`.** It only checks the body first, so a ' +
      'bad body still gets its `400` or `422`. Nothing is saved.',
  })
  @ApiNotImplementedResponse({ description: 'Booking is not available yet.' })
  @ApiUnprocessableEntityResponse({
    description: '`endsAt` is not after `startsAt`.',
  })
  @ApiClerkAuthResponses()
  create(@Body() payload: CreateBookingDto, @CurrentClerkUser() user: ClerkUser): never {
    if (payload.endsAt.getTime() <= payload.startsAt.getTime()) {
      throw new HttpException(
        'endsAt must be after startsAt',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    throw new HttpException(
      `Booking creation is not wired yet (Phase 1 scaffold). Authenticated as Clerk user ${user.userId}.`,
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  @Get('me/bookings/:id')
  @ApiTags(TAGS.bookings)
  @ApiOperation({
    summary: 'Open one of my bookings',
    description:
      'The booking with its meals and its shopping list (`shoppingList: null` until one ' +
      'is made). Only the client who booked can open it; anyone else gets `404`.\n\n' +
      'Note the path: `/bookings/me/bookings/{id}`.',
  })
  @ApiBookingIdParam()
  @ApiOkResponse({
    description: 'The booking.',
    example: BOOKING_DETAIL,
  })
  @ApiNotFoundResponse({ description: 'No such booking, or not yours.' })
  @ApiClerkAuthResponses()
  async meBookingDetail(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id') bookingId: string,
  ): Promise<unknown> {
    const booking = await this.bookings.getMyBookingDetail(user.userId, bookingId);
    if (!booking) {
      throw new NotFoundException('Booking not found.');
    }
    return booking;
  }

  @Get('admin/bookings/:id')
  @ApiTags(TAGS.adminBookings)
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Open any booking',
    description:
      'Any booking, with its client, its meals and its shopping list.\n\n' +
      'Note the path: `/bookings/admin/bookings/{id}`.',
  })
  @ApiBookingIdParam()
  @ApiOkResponse({
    description: 'The booking.',
    example: {
      ...BOOKING_DETAIL,
      client: {
        id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        email: 'client@example.com',
        fullName: 'Lucas Martin',
        role: 'client',
      },
    },
  })
  @ApiNotFoundResponse({ description: 'No booking with this id.' })
  @ApiAdminAuthResponses()
  async adminBookingDetail(@Param('id') bookingId: string): Promise<unknown> {
    const booking = await this.bookings.getAdminBookingDetail(bookingId);
    if (!booking) {
      throw new NotFoundException('Booking not found.');
    }
    return booking;
  }

  @Post('admin/bookings/:id/shopping-list/regenerate')
  @ApiTags(TAGS.adminBookings)
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: "Rebuild a booking's shopping list",
    description:
      "Recomputes the booking's shopping list from the recipe versions it cooks from: " +
      'each ingredient scaled to the portions booked, the same ingredient in the same ' +
      "unit added up. The batch cooker's corrections are kept. Use it after the meals " +
      'or portions change.\n\n' +
      'Note the path: `/bookings/admin/bookings/{id}/shopping-list/regenerate`.',
  })
  @ApiBookingIdParam()
  @ApiCreatedResponse({ description: 'The new shopping list.', example: SHOPPING_LIST })
  @ApiNotFoundResponse({ description: 'No booking with this id.' })
  @ApiAdminAuthResponses()
  regenerateShoppingList(@Param('id') bookingId: string) {
    return this.shoppingLists.regenerateForBooking(bookingId);
  }
}
