import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { ApiClerkAuthResponses } from '../../common/swagger/auth-responses';
import { CreatePaymentIntentDto, PaymentIntentDto } from './dto/payment.dto';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
@UseGuards(ClerkAuthGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('intent')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Create a card PaymentIntent for a booking',
    description:
      'Starts a Stripe Connect destination charge: the chef receives the amount minus ' +
      'the platform commission, which Stripe withholds as the `application_fee_amount`. ' +
      'Confirm the returned `clientSecret` with Stripe.js — the backend never sees card ' +
      'details, and the booking only becomes `confirmed` when the ' +
      '`payment_intent.succeeded` webhook arrives. Calling it twice for the same booking ' +
      'returns the pending intent instead of creating a second one.',
  })
  @ApiOkResponse({
    type: PaymentIntentDto,
    description: 'Client secret plus the amounts recorded for this attempt.',
  })
  @ApiNotFoundResponse({ description: 'Booking not found or not owned by the caller.' })
  @ApiConflictResponse({
    description:
      'Booking is not `pending`, already paid, or the chef has not finished Stripe ' +
      'Connect onboarding (no `chargesEnabled` / `payoutsEnabled`).',
  })
  @ApiClerkAuthResponses()
  createIntent(
    @CurrentClerkUser() user: ClerkUser,
    @Body() payload: CreatePaymentIntentDto,
  ): Promise<PaymentIntentDto> {
    return this.payments.createIntentForBooking(user.userId, payload.bookingId);
  }
}
