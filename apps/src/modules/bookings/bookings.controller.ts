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
import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { ShoppingListsService } from '../shopping-lists/shopping-lists.service';
import { BookingsService } from './bookings.service';
import { BookingReadDto } from './dto/booking-read.dto';
import { CreateBookingDto } from './dto/create-booking.dto';

@ApiTags('bookings')
@ApiBearerAuth()
@Controller('bookings')
@UseGuards(ClerkAuthGuard)
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly shoppingLists: ShoppingListsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List all bookings (admin-style listing)',
    description:
      'Returns every booking in the database. Intended for internal/admin tooling during Phase 1; ' +
      'client-scoped listing may be added later.',
  })
  @ApiOkResponse({
    type: BookingReadDto,
    isArray: true,
    description: 'All bookings with client, chef, schedule, and price fields.',
  })
  @ApiClerkAuthResponses()
  async list(): Promise<BookingReadDto[]> {
    const rows = await this.bookings.list();
    return rows.map((row) => BookingReadDto.fromEntity(row));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a booking',
    description:
      'Persists a `pending` booking for the authenticated client and assigns a ' +
      '`LF-<year>-NNNN` reference. `amountTtc` is the quoted `priceCents`; ' +
      '`amountAfterTax` is half of it — the 50 % "service à la personne" tax credit. ' +
      'Pay it with `POST /payments/intent`. Shopping-list generation and notifications ' +
      'are not triggered here yet.',
  })
  @ApiCreatedResponse({
    type: BookingReadDto,
    description:
      'The created booking, `status: pending`, with its reference and amounts.',
  })
  @ApiNotFoundResponse({
    description: 'Unknown chef profile or service offer.',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation error when `endsAt` is not strictly after `startsAt`.',
  })
  @ApiClerkAuthResponses()
  async create(
    @Body() payload: CreateBookingDto,
    @CurrentClerkUser() user: ClerkUser,
  ): Promise<BookingReadDto> {
    if (payload.endsAt.getTime() <= payload.startsAt.getTime()) {
      throw new HttpException(
        'endsAt must be after startsAt',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const booking = await this.bookings.create(user.userId, payload);
    return BookingReadDto.fromEntity(booking);
  }

  @Get('me/bookings/:id')
  @ApiOperation({
    summary: 'Get my booking detail with shopping list',
    description:
      'Returns a single booking owned by the authenticated client, including the generated shopping list. ' +
      '`:id` is the booking uuid.',
  })
  @ApiParam({
    name: 'id',
    description: 'Booking uuid.',
    example: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
  })
  @ApiOkResponse({
    description: 'Booking detail with nested shopping list items.',
  })
  @ApiNotFoundResponse({ description: 'Booking not found or not owned by the caller.' })
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
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Admin: get any booking detail with shopping list',
    description:
      'Returns a booking by id without client ownership check. Includes shopping list for kitchen prep.',
  })
  @ApiParam({
    name: 'id',
    description: 'Booking uuid.',
    example: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
  })
  @ApiOkResponse({ description: 'Booking detail with nested shopping list items.' })
  @ApiNotFoundResponse({ description: 'Booking not found.' })
  @ApiAdminAuthResponses()
  async adminBookingDetail(@Param('id') bookingId: string): Promise<unknown> {
    const booking = await this.bookings.getAdminBookingDetail(bookingId);
    if (!booking) {
      throw new NotFoundException('Booking not found.');
    }
    return booking;
  }

  @Post('admin/bookings/:id/shopping-list/regenerate')
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Admin: regenerate shopping list for a booking',
    description:
      'Rebuilds the shopping list from the booking selected meals and portion counts. ' +
      'Use after menu or portion changes.',
  })
  @ApiParam({
    name: 'id',
    description: 'Booking uuid.',
    example: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
  })
  @ApiOkResponse({ description: 'Regenerated shopping list for the booking.' })
  @ApiAdminAuthResponses()
  regenerateShoppingList(@Param('id') bookingId: string) {
    return this.shoppingLists.regenerateForBooking(bookingId);
  }
}
