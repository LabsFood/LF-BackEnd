import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';

import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { ApiClerkAuthResponses } from '../../common/swagger/auth-responses';
import {
  CheckoutSessionDto,
  CreateCheckoutSessionDto,
  CreatePaymentIntentDto,
  PaymentIntentDto,
} from './dto/payment.dto';
import { PaymentsService } from './payments.service';

@ApiTags('Payments')
@ApiBearerAuth()
@Controller('payments')
@UseGuards(ClerkAuthGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('intent')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({ register: true })
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

  @Post('checkout-session')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({ register: true })
  @ApiOperation({
    summary: 'Open a Stripe page to pay a prestation by card',
    description:
      'Returns the `url` of a Stripe Checkout page to send the browser to. No card ' +
      'detail ever reaches Lab’s Food.\n\n' +
      '- **The amount is computed here**: what is left to pay on the booking. ' +
      '`amountCents` is only compared with it, and a difference answers ' +
      '`409 AMOUNT_MISMATCH` with the right `amountCents`.\n' +
      '- A prestation is paid **after** it took place (`409 BOOKING_NOT_DUE` before).\n' +
      '- Two quick clicks get the same page back.\n' +
      '- Coming back to `successUrl` proves nothing: the payment is confirmed by ' +
      'Stripe’s webhook. Read `GET /me/bookings/{id}/payment-options` until `status` ' +
      'is `paid`.\n' +
      '- The batch cooker receives the amount less the commission, which Stripe ' +
      'withholds.',
  })
  @ApiOkResponse({ type: CheckoutSessionDto, description: 'The Stripe page.' })
  @ApiNotFoundResponse({ description: 'Booking not found or not owned by the caller.' })
  @ApiConflictResponse({
    description:
      '`AMOUNT_MISMATCH`, `BOOKING_NOT_DUE`, `BOOKING_CANCELLED`, already paid, or the ' +
      'batch cooker cannot be paid by card yet (Stripe onboarding not finished).',
  })
  @ApiUnprocessableEntityResponse({
    description: '`RETURN_URL_NOT_ALLOWED`: a return URL is not on a Lab’s Food site.',
  })
  @ApiClerkAuthResponses()
  createCheckoutSession(
    @CurrentClerkUser() user: ClerkUser,
    @Body() payload: CreateCheckoutSessionDto,
  ): Promise<CheckoutSessionDto> {
    return this.payments.createCheckoutSession(user.userId, payload);
  }
}
