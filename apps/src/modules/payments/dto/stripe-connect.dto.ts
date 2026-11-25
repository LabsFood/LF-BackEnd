import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateStripeConnectLinkDto {
  @ApiPropertyOptional({
    description:
      'Stripe account token (`POST /v2/core/account_tokens`, made in the browser with the ' +
      'publishable key) holding the chef contact e-mail. Required on the first call, ' +
      'which creates the account; ignored once the account exists.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  accountToken?: string;
}

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

export class CreateSepaMandateCheckoutDto {
  @ApiProperty({
    description:
      'The chef page Stripe sends the chef back to, on one of our own sites. Stripe adds ' +
      '`mandat=signe&session_id=…` once signed, `mandat=annule` if the chef gave up.',
    example: 'https://b.lf.fr/espace-chef/remuneration',
  })
  @IsString()
  @MaxLength(2000)
  returnUrl!: string;
}

export class SepaMandateCheckoutDto {
  @ApiProperty({
    description:
      'Stripe-hosted page where the chef enters their IBAN and signs. Single use, ' +
      'short-lived: redirect to it straight away.',
    example: 'https://checkout.stripe.com/c/pay/cs_test_a1B2c3',
  })
  url!: string;
}

export class ConfirmSepaMandateDto {
  @ApiProperty({
    description: 'The `session_id` Stripe appended to the return URL.',
    example: 'cs_test_a1B2c3D4e5',
  })
  @IsString()
  @Matches(/^cs_(test|live)_[A-Za-z0-9]+$/, {
    message: 'sessionId is not a Checkout session id.',
  })
  sessionId!: string;
}

export class SepaMandateStatusDto {
  @ApiProperty({
    enum: ['pending', 'active', 'revoked', 'failed'],
    description:
      'Mandate lifecycle. `active` once signed: only then are CESU and the immediate ' +
      'advance offered for this chef. `revoked` when the bank or the chef cancelled it.',
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
