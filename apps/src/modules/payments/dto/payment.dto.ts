import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

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
  @ApiProperty({
    example: '3d1f7a20-5b6c-4e8d-9f0a-1b2c3d4e5f60',
    format: 'uuid',
    description: 'Local `payments.id` for this attempt.',
  })
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
 * Who issues the attestation: Lab's Food, under the company's own SAP declaration.
 *
 * The SAS is the « services à la personne » provider (prestataire) the household pays
 * and that invoices it (prix net flow), so it is the one that attests, whichever batch
 * cooker did the work (MajorD, 26/11/2026).
 */
export class FiscalAttestationIssuerDto {
  @ApiProperty({ description: 'Trade name, as shown everywhere.', example: 'Lab’s Food' })
  name!: string;

  @ApiProperty({
    description: 'Registered company, for the legal mention only.',
    example: 'Lab’s Food Batchcooking SAS',
  })
  legalName!: string;

  @ApiPropertyOptional({ nullable: true, example: '131895203' })
  siren!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: '200 rue de la Croix Nivert, 75015 Paris',
  })
  address!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'The SAS SAP declaration number the attestation is issued under ' +
      '(`SAP_DECLARATION_NUMBER`). `null` while it is not configured.',
    example: 'SAP100715036',
  })
  sapDeclarationNumber!: string | null;
}

/**
 * One batch cooker's share of a client's yearly total.
 *
 * A breakdown only: the attestation itself is issued by Lab's Food under its own SAP
 * declaration (`FiscalAttestationDto.issuer`). The chef's own declaration fields below
 * are kept for the admin's dossier check, never printed on the client's attestation.
 */
export class FiscalAttestationProviderDto {
  @ApiProperty({
    example: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
    format: 'uuid',
    description: 'Issuing chef (`chef_profiles.id`).',
  })
  chefProfileId!: string;

  @ApiProperty({ description: 'Chef display name.', example: 'Chef Marie D.' })
  chefDisplayName!: string;

  @ApiProperty({
    description:
      'Whether the chef has declared their own SAP route (dossier check only: the ' +
      'attestation is issued by Lab’s Food either way).',
    example: true,
  })
  sapDeclared!: boolean;

  @ApiPropertyOptional({
    enum: ['type_a_nova', 'type_b_cooperative'],
    nullable: true,
    description: 'The chef SAP declaration route, when declared (dossier check only).',
  })
  declarationType?: SapDeclarationType | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'The chef own NOVA number, for `type_a_nova` chefs (dossier check only, never ' +
      'the number on the attestation).',
    example: 'SAP123456789',
  })
  novaCode?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Cooperative the chef declares through (dossier check only).',
    example: 'Coop SAP',
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
      'The part of `eligibleAmountCents` Lab’s Food attests, in minor units. Only ' +
      'e-CESU payments narrow it (the issuer already attests the share it financed). ' +
      'Paper CESU stays attested here. `notes` says when it applied.',
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
 * One attestation per client and year, issued by Lab's Food under the SAS SAP
 * declaration (`issuer`). `providers` breaks the total down by batch cooker.
 */
export class FiscalAttestationDto {
  @ApiProperty({
    example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    format: 'uuid',
    description: 'Postgres `users.id` of the client.',
  })
  clientId!: string;

  @ApiPropertyOptional({
    example: 'Sophie Martin',
    nullable: true,
    description: 'Client full name, when known.',
  })
  clientName?: string | null;

  @ApiProperty({ description: 'Client email.', example: 'client@example.com' })
  clientEmail!: string;

  @ApiProperty({ description: 'Calendar year covered.', example: 2026 })
  year!: number;

  @ApiProperty({
    description:
      'Sum across every batch cooker, in minor units: the amount the attestation ' +
      'covers, before the e-CESU exclusion.',
    example: 48000,
  })
  eligibleAmountCents!: number;

  @ApiProperty({
    description:
      "Sum of every provider's `platformAttestedAmountCents`, in minor units: what " +
      'Lab’s Food itself attests, as opposed to what the client is entitled to claim.',
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
    type: FiscalAttestationIssuerDto,
    description: 'Lab’s Food, under the SAS SAP declaration: who issues the attestation.',
  })
  issuer!: FiscalAttestationIssuerDto;

  @ApiProperty({
    type: FiscalAttestationProviderDto,
    isArray: true,
    description: 'Per-batch-cooker breakdown, largest amount first.',
  })
  providers!: FiscalAttestationProviderDto[];
}

/** `POST /payments/checkout-session`, as the payment screen builds it (FLOW-03 §3). */
export class CreateCheckoutSessionDto {
  @ApiProperty({
    format: 'uuid',
    description: 'The booking to pay (`id` from `GET /me/bookings`).',
    example: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
  })
  @IsUUID()
  orderId!: string;

  @ApiProperty({
    enum: ['card'],
    description:
      'Only `card` opens a Stripe page. CESU is declared with `POST /payments/cesu` and ' +
      'the immediate advance with `POST /bookings/{id}/settle`.',
  })
  @IsIn(['card'])
  method!: 'card';

  @ApiProperty({
    description:
      'What the screen believes is due, in cents. Not trusted: compared with the amount ' +
      'the API computes, and refused with `409 AMOUNT_MISMATCH` when they differ.',
    example: 18000,
  })
  @IsInt()
  @IsPositive()
  amountCents!: number;

  @ApiPropertyOptional({ example: 'eur' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({
    description: 'Sent by the screen for its own display. Ignored: declare CESU first.',
    example: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  cesuDeclaredCents?: number;

  @ApiPropertyOptional({
    description: 'A saved card. Ignored for now: Stripe’s page asks for the card.',
    example: 'pm_1',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  paymentMethodId?: string;

  @ApiProperty({
    description: 'Where Stripe sends the client back after paying. One of our own sites.',
    example:
      'https://batchcooking.labsfood.fr/espace-client/commandes/c2eebc99?paiement=succes',
  })
  @IsString()
  @MaxLength(2000)
  successUrl!: string;

  @ApiProperty({
    description:
      'Where Stripe sends the client back if they give up. One of our own sites.',
    example:
      'https://batchcooking.labsfood.fr/espace-client/commandes/c2eebc99?paiement=annule',
  })
  @IsString()
  @MaxLength(2000)
  cancelUrl!: string;
}

export class CheckoutSessionDto {
  @ApiProperty({ example: 'cs_test_a1B2c3' })
  sessionId!: string;

  @ApiProperty({
    description: 'The Stripe page to send the browser to.',
    example: 'https://checkout.stripe.com/c/pay/cs_test_a1B2c3',
  })
  url!: string;
}
