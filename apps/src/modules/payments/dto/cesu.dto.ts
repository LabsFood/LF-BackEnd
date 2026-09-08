import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

import type {
  CesuIssuer,
  CesuMedium,
  CesuSettlementStatus,
  PaymentStatus,
  SapExternalStatus,
} from '../../../generated/prisma/client';
import { CESU_SUPPORTED_ISSUERS } from '../chef-cesu-info';

export const CESU_MEDIUMS = [
  'ecesu',
  'cesu_paper',
] as const satisfies readonly CesuMedium[];

/**
 * `POST /payments/cesu` — the client declaring a prefinanced CESU payment they already
 * made from their issuer's beneficiary area.
 *
 * Nothing here is verifiable: no issuer exposes an API, there is no normalised
 * transaction reference, and Domiserve runs its own circuit outside the CRCESU. The
 * declaration opens a payment the **chef** then confirms — they are the party who
 * receives both the issuer's notification and the money.
 */
export class DeclareCesuPaymentDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Booking being paid. Must belong to the caller and still be `pending`.',
    example: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
  })
  @IsUUID()
  bookingId!: string;

  @ApiProperty({
    description:
      'Amount paid in CESU, VAT included, in minor units. May not exceed what is left ' +
      'to cover on the booking — CRCESU rules forbid any surcharge, so there is no fee ' +
      'field on this route and no way to declare more than is owed.',
    example: 6000,
  })
  @IsInt()
  @IsPositive()
  amountTtc!: number;

  @ApiProperty({
    enum: CESU_MEDIUMS,
    description:
      'Electronic CESU (the main circuit) or paper titres. For paper the platform ' +
      'provides the payment method, the invoice and the commission debit only — ' +
      'depositing, validating and cashing the titres is the chef own responsibility.',
    example: 'ecesu',
  })
  @IsIn(CESU_MEDIUMS)
  medium!: CesuMedium;

  @ApiPropertyOptional({
    enum: CESU_SUPPORTED_ISSUERS,
    description:
      'Issuer the client paid from. Expected for `ecesu`, irrelevant on paper.',
    example: 'pluxee',
  })
  @IsOptional()
  @IsIn(CESU_SUPPORTED_ISSUERS)
  issuer?: CesuIssuer;

  // ponytail: no file attachment for the proof — free text only. Wire up S3 when the
  // reference field alone stops being enough evidence for a chef/admin dispute.
  @ApiPropertyOptional({
    maxLength: 255,
    description:
      'Free-text reference from the issuer confirmation email. A supporting document, ' +
      'not a proof — nothing about it can be checked. Attaching the document itself ' +
      'waits on S3.',
    example: 'PLX-2026-0918-44711',
  })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  clientProofRef?: string;
}

/** `POST /me/chef/cesu-payments/:id/reject`. */
export class RejectCesuPaymentDto {
  @ApiProperty({
    maxLength: 500,
    description: 'Why the funds were never received. Shown to the client.',
    example: 'Aucun règlement Pluxee reçu à ce jour.',
  })
  @IsString()
  @Length(1, 500)
  reason!: string;
}

/**
 * `POST /admin/cesu-payments/:id/force-settle`.
 *
 * The proof reference is mandatory: this route writes a tax-credit line in a chef's name
 * without that chef having confirmed anything, so it has to leave a trace of what the
 * admin was looking at when they did it.
 */
export class ForceSettleCesuPaymentDto {
  @ApiProperty({
    maxLength: 255,
    description:
      'Reference of the evidence the admin acted on (support ticket, issuer statement, ' +
      'chef email). Recorded on the settlement alongside the admin identity.',
    example: 'ZD-18422 / relevé Edenred 2026-09',
  })
  @IsString()
  @Length(1, 255)
  proofRef!: string;
}

/** `POST /admin/commission-invoices/run-due` — the `monthly_batch` window. */
export class RunDueInvoicesDto {
  @ApiPropertyOptional({
    description:
      'Start of the period, ISO 8601. Defaults to the first day of the previous month.',
    example: '2026-08-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsString()
  periodStart?: string;

  @ApiPropertyOptional({
    description:
      'End of the period, ISO 8601, exclusive. Defaults to the first day of the current month.',
    example: '2026-09-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsString()
  periodEnd?: string;
}

export class CesuPaymentDto {
  @ApiProperty({ format: 'uuid', description: 'Local `payments.id`.' })
  paymentId!: string;

  @ApiProperty({ format: 'uuid', description: 'Booking paid.' })
  bookingId!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Booking reference, when set.' })
  bookingReference?: string | null;

  @ApiProperty({ description: 'Declared amount, VAT included, in minor units.' })
  amountTtc!: number;

  @ApiProperty({ description: 'ISO 4217 currency code.', example: 'EUR' })
  currency!: string;

  @ApiProperty({
    enum: ['pending', 'succeeded', 'paid', 'failed', 'refunded', 'partially_refunded'],
    description: '`pending` until the chef confirms, then `succeeded`.',
  })
  paymentStatus!: PaymentStatus;

  @ApiProperty({ enum: CESU_MEDIUMS, description: 'Electronic or paper CESU.' })
  medium!: CesuMedium;

  @ApiPropertyOptional({ enum: CESU_SUPPORTED_ISSUERS, nullable: true, description: 'Issuer.' })
  issuer?: CesuIssuer | null;

  @ApiProperty({
    enum: ['declared', 'confirmed', 'rejected'],
    description: 'Where the declaration stands with the chef.',
  })
  settlementStatus!: CesuSettlementStatus;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Client-supplied issuer reference.',
  })
  clientProofRef?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    format: 'date-time',
    description: 'When the chef (or an admin) confirmed receipt.',
  })
  confirmedAt?: Date | null;

  @ApiPropertyOptional({ nullable: true, description: 'Why the chef rejected it.' })
  rejectionReason?: string | null;

  @ApiProperty({
    description: 'Whether an admin settled this instead of the chef.',
    example: false,
  })
  adminOverride!: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'Client display name.' })
  clientName?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Chef display name.' })
  chefDisplayName?: string | null;

  @ApiProperty({ type: String, format: 'date-time', description: 'Declaration time.' })
  declaredAt!: Date;
}

/**
 * `GET /me/bookings/:id/payment-status` — what is left to pay.
 *
 * Coverage counts **`succeeded` payments only**, which is what makes a booking split
 * between CESU and card work: the booking confirms when the parts add up.
 */
export class BookingPaymentStatusDto {
  @ApiProperty({ format: 'uuid' })
  bookingId!: string;

  @ApiProperty({ description: 'Booking total, VAT included, in minor units.' })
  amountTtcCents!: number;

  @ApiProperty({ description: 'Sum of settled payments, in minor units.' })
  coveredAmountCents!: number;

  @ApiProperty({
    description:
      'Amount still to pay, in minor units. A card intent is created for exactly this, ' +
      'and a CESU declaration may not exceed it.',
  })
  remainingAmountCents!: number;

  @ApiProperty({ description: 'ISO 4217 currency code.', example: 'EUR' })
  currency!: string;

  @ApiProperty({ description: 'Whether the booking is fully paid.' })
  fullyCovered!: boolean;

  @ApiProperty({
    description:
      'Whether the chef can be paid in prefinanced CESU: opted in **and** holding a NAN.',
  })
  cesuAvailable!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'The chef CRCESU affiliation number. The client needs it **before** paying, to add ' +
      'the chef as an intervenant on their issuer portal.',
    example: '1234567',
  })
  crcesuNan?: string | null;
}

/**
 * Public, on purpose. The NAN has to be readable before any payment exists: without it a
 * client cannot add the chef on their issuer's portal, and invoice A only arrives after
 * the service.
 */
export class ChefCesuInfoDto {
  @ApiProperty({ format: 'uuid', description: 'Chef profile id.' })
  chefProfileId!: string;

  @ApiProperty({ description: 'Chef display name.', example: 'Chef Marie D.' })
  chefDisplayName!: string;

  @ApiProperty({ description: 'Whether the chef accepts prefinanced CESU.' })
  acceptsCesu!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'CRCESU national affiliation number (NAN) to enter on the issuer portal.',
    example: '1234567',
  })
  crcesuNan?: string | null;

  @ApiProperty({
    enum: ['not_started', 'pending', 'active'],
    description: 'CRCESU affiliation status, admin-maintained.',
  })
  crcesuAffiliationStatus!: SapExternalStatus;

  @ApiProperty({
    enum: CESU_SUPPORTED_ISSUERS,
    isArray: true,
    description: 'Issuers a beneficiary can pay from. Informational — none is queryable.',
  })
  supportedIssuers!: CesuIssuer[];
}
