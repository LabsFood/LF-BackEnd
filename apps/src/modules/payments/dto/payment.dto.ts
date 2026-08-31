import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreatePaymentIntentDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Booking to pay. Must belong to the caller and still be `pending`.',
    example: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
  })
  @IsUUID()
  bookingId!: string;
}

export class PaymentIntentDto {
  @ApiProperty({ format: 'uuid', description: 'Local `payments.id` for this attempt.' })
  paymentId!: string;

  @ApiProperty({
    description:
      'Stripe PaymentIntent client secret. Confirm it with Stripe.js on the frontend; ' +
      'the backend never sees the card details.',
    example: 'pi_3Ab...._secret_xyz',
  })
  clientSecret!: string;

  @ApiProperty({
    description: 'Amount to charge, VAT included, in minor units.',
    example: 12500,
  })
  amountTtc!: number;

  @ApiProperty({ description: 'ISO 4217 currency code.', example: 'EUR' })
  currency!: string;

  @ApiProperty({
    description:
      'Platform commission taken from the charge as the Stripe `application_fee_amount`, ' +
      'VAT included, in minor units. The chef receives the remainder.',
    example: 2250,
  })
  commissionTtc!: number;
}

/** `GET /me/fiscal-attestations/:year` and the admin detail route. */
export class FiscalAttestationDto {
  @ApiProperty({ format: 'uuid', description: 'Postgres `users.id` of the client.' })
  clientId!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Client full name, when known.' })
  clientName?: string | null;

  @ApiProperty({ description: 'Client email.', example: 'client@example.com' })
  clientEmail!: string;

  @ApiProperty({ description: 'Calendar year covered.', example: 2026 })
  year!: number;

  @ApiProperty({
    description:
      'Sum of amounts eligible for the 50 % "service à la personne" tax credit, in ' +
      'minor units, across succeeded payments of the year.',
    example: 48000,
  })
  eligibleAmountCents!: number;

  @ApiProperty({
    description: 'Number of succeeded payments counted in `eligibleAmountCents`.',
    example: 4,
  })
  paymentsCount!: number;

  @ApiProperty({ description: 'ISO 4217 currency code.', example: 'EUR' })
  currency!: string;
}
