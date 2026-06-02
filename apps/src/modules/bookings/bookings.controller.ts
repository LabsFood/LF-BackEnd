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
  ApiOkResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

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
  @ApiOkResponse({ type: BookingReadDto, isArray: true })
  async list(): Promise<BookingReadDto[]> {
    const rows = await this.bookings.list();
    return rows.map((row) => BookingReadDto.fromEntity(row));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: BookingReadDto })
  @ApiUnprocessableEntityResponse({ description: 'ends_at must be after starts_at' })
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
  @ApiOkResponse({ description: 'Authenticated client booking detail with shopping list.' })
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
  @ApiOkResponse({ description: 'Admin booking detail with shopping list.' })
  async adminBookingDetail(@Param('id') bookingId: string): Promise<unknown> {
    const booking = await this.bookings.getAdminBookingDetail(bookingId);
    if (!booking) {
      throw new NotFoundException('Booking not found.');
    }
    return booking;
  }

  @Post('admin/bookings/:id/shopping-list/regenerate')
  @UseGuards(AdminGuard)
  @ApiOkResponse({ description: 'Regenerates shopping list from selected meals and portions.' })
  regenerateShoppingList(@Param('id') bookingId: string) {
    return this.shoppingLists.regenerateForBooking(bookingId);
  }
}
