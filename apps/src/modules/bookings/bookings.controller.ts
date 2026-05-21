import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
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

import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { BookingsService } from './bookings.service';
import { BookingReadDto } from './dto/booking-read.dto';
import { CreateBookingDto } from './dto/create-booking.dto';

@ApiTags('bookings')
@ApiBearerAuth()
@Controller('bookings')
@UseGuards(ClerkAuthGuard)
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

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
}
