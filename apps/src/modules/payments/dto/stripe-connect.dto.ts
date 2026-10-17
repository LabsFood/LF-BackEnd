import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StripeConnectLinkDto {
  @ApiProperty({
    description:
      'Single-use Stripe hosted onboarding URL. Short-lived — request a new one rather ' +
      'than storing it.',
    example: 'https://connect.stripe.com/setup/e/acct_123/abcdef',
  })
  url!: string;
}

export class StripeConnectStatusDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Connected account id, `null` until onboarding has been started once.',
    example: 'acct_1AbCdEfGhIjKlMnO',
  })
  stripeAccountId?: string | null;

  @ApiProperty({
    description:
      'Whether Stripe will accept charges destined for this account. Mirrored from the ' +
      '`account.updated` webhook.',
    example: false,
  })
  chargesEnabled!: boolean;

  @ApiProperty({
    description:
      'Whether Stripe will pay out to this account. Mirrored from `account.updated`.',
    example: false,
  })
  payoutsEnabled!: boolean;

  @ApiProperty({
    description: 'Whether the chef finished the hosted onboarding form.',
    example: false,
  })
  detailsSubmitted!: boolean;
}

export class SepaMandateSetupIntentDto {
  @ApiProperty({
    description:
      'Stripe SetupIntent client secret. Collect the IBAN with Stripe Elements on the ' +
      'frontend and confirm it there — the backend never handles the IBAN.',
    example: 'seti_1Ab...._secret_xyz',
  })
  clientSecret!: string;
}

export class SepaMandateStatusDto {
  @ApiProperty({
    enum: ['pending', 'active', 'revoked', 'failed'],
    description: 'Mandate lifecycle. `active` once Stripe confirms the SetupIntent.',
    example: 'pending',
  })
  status!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Last four characters of the mandated IBAN.',
    example: '3000',
  })
  ibanLast4?: string | null;

  @ApiPropertyOptional({
    example: '2026-09-15T10:22:41.000Z',
    nullable: true,
    type: String,
    format: 'date-time',
    description: 'When Stripe confirmed the mandate.',
  })
  signedAt?: Date | null;
}
