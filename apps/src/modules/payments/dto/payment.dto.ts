import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

import { PaymentMethod, SapDeclarationType } from '../../../generated/prisma/client';

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

/**
 * One provider's share of a client's yearly total.
 *
 * The chef is the declared "service à la personne" provider (prestataire), so the
 * attestation a client files is issued **per chef**, carrying that chef's own
 * declaration — a NOVA code for `type_a_nova`, the cooperative for
 * `type_b_cooperative`. A chef with no `SapProfile` cannot issue one at all.
 */
export class FiscalAttestationProviderDto {
  @ApiProperty({ format: 'uuid', description: 'Issuing chef (`chef_profiles.id`).' })
  chefProfileId!: string;

  @ApiProperty({ description: 'Chef display name.', example: 'Chef Marie D.' })
  chefDisplayName!: string;

  @ApiProperty({
    description:
      'Whether the chef has declared a SAP route. `false` means they cannot legally ' +
      'issue an attestation for these amounts yet.',
    example: true,
  })
  sapDeclared!: boolean;

  @ApiPropertyOptional({
    enum: ['type_a_nova', 'type_b_cooperative'],
    nullable: true,
    description: 'The chef SAP declaration route, when declared.',
  })
  declarationType?: SapDeclarationType | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'NOVA declaration number, for `type_a_nova` chefs.',
    example: 'SAP123456789',
  })
  novaCode?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Cooperative issuing on the chef behalf, for `type_b_cooperative`.',
    example: 'Unipros',
  })
  cooperativeName?: string | null;

  @ApiProperty({
    description:
      'Amount paid to this chef that is eligible for the credit, in minor units. The ' +
      "client's own total, whoever issues the attestation for it.",
    example: 30000,
  })
  eligibleAmountCents!: number;

  @ApiProperty({
    description:
      "The part of `eligibleAmountCents` **LAB'S FOOD** attests, in minor units. Two " +
      'exclusions narrow it: a `type_b_cooperative` chef (the cooperative issues both ' +
      'invoice and attestation) and e-CESU payments (the issuer already attests the share ' +
      'it financed). Paper CESU stays attested here. `notes` says which applied.',
    example: 18000,
  })
  platformAttestedAmountCents!: number;

  @ApiProperty({
    enum: ['cb', 'avance_immediate', 'cesu'],
    isArray: true,
    description: 'Payment methods used with this chef during the year.',
    example: ['cb', 'cesu'],
  })
  paymentMethods!: PaymentMethod[];

  @ApiProperty({
    isArray: true,
    type: String,
    description:
      'Plain-language reasons some of the amount is not attested by the platform. Empty ' +
      'when the platform attests everything.',
    example: ['Part réglée en e-CESU — attestation délivrée par votre émetteur.'],
  })
  notes!: string[];

  @ApiProperty({
    description: 'Succeeded payments to this chef in the year.',
    example: 3,
  })
  paymentsCount!: number;

  @ApiProperty({ description: 'ISO 4217 currency code.', example: 'EUR' })
  currency!: string;
}

/**
 * `GET /me/fiscal-attestations/:year` and the admin routes.
 *
 * The client-level totals are a **dashboard summary, not an attestation**: each entry
 * in `providers` is the unit a real attestation is issued for, because each chef is an
 * independent declared provider.
 */
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
      'Sum across every provider, in minor units. Informational only — no single ' +
      'document covers amounts from several independent providers.',
    example: 48000,
  })
  eligibleAmountCents!: number;

  @ApiProperty({
    description:
      "Sum of every provider's `platformAttestedAmountCents`, in minor units — what " +
      "LAB'S FOOD itself attests, as opposed to what the client is entitled to claim.",
    example: 30000,
  })
  platformAttestedAmountCents!: number;

  @ApiProperty({
    description: 'Succeeded payments counted across all providers.',
    example: 4,
  })
  paymentsCount!: number;

  @ApiProperty({ description: 'ISO 4217 currency code.', example: 'EUR' })
  currency!: string;

  @ApiProperty({
    type: FiscalAttestationProviderDto,
    isArray: true,
    description: 'Per-chef breakdown, largest amount first. One attestation per entry.',
  })
  providers!: FiscalAttestationProviderDto[];
}
