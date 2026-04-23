import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';

@ApiTags('bookings')
@ApiBearerAuth()
@Controller('bookings')
@UseGuards(ClerkAuthGuard)
export class BookingsController {
  /** List bookings (empty array in Phase 1; returns an auth-gated shape only). */
  @Get()
  list(): unknown[] {
    return [];
  }

  /** Create a booking (Phase 1 scaffold; returns 501 until Stripe/Cronofy wiring lands). */
  @Post()
  create(@Req() req: { clerkUser?: ClerkUser }): never {
    throw new HttpException(
      `Booking creation is not wired yet (Phase 1 scaffold). Authenticated as Clerk user ${
        req.clerkUser?.userId ?? 'unknown'
      }.`,
      HttpStatus.NOT_IMPLEMENTED,
    );
  }
}
