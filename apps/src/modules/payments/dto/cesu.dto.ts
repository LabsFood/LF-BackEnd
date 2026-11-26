import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

import type {
  CesuIssuer,
  CesuMedium,
  CesuSettlementStatus,
  PaymentStatus,
} from '../../../generated/prisma/client';
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_BYTES,
} from '../../chef-onboarding/services/kyc-storage.service';
import { CESU_SUPPORTED_ISSUERS } from '../chef-cesu-info';

/** The `uploadId` a proof upload link comes with. */
const PROOF_UPLOAD_ID = /^up_[a-f0-9]{24}$/;

/** What a settlement can hold: paper rows may exist from before it was withdrawn. */
export const CESU_MEDIUMS = [
  'ecesu',
  'cesu_paper',
] as const satisfies readonly CesuMedium[];

/** What a client can declare today: paper is no longer offered, e-CESU only. */
export const CESU_DECLARABLE_MEDIUMS = ['ecesu'] as const satisfies readonly CesuMedium[];

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
    enum: CESU_DECLARABLE_MEDIUMS,
    description:
      'Electronic CESU, the only circuit offered. Paper titres are no longer accepted ' +
      '(`cesu_paper` is refused with a 400); existing paper settlements stay readable.',
    example: 'ecesu',
  })
  @IsIn(CESU_DECLARABLE_MEDIUMS)
  medium!: CesuMedium;

  @ApiPropertyOptional({
    enum: CESU_SUPPORTED_ISSUERS,
    description: 'Issuer the client paid from.',
    example: 'pluxee',
  })
  @IsOptional()
  @IsIn(CESU_SUPPORTED_ISSUERS)
  issuer?: CesuIssuer;

  @ApiPropertyOptional({
    maxLength: 255,
    description:
      'Free-text reference from the issuer confirmation email. Optional, and nothing ' +
      'about it can be checked: the evidence is the document below.',
    example: 'PLX-2026-0918-44711',
  })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  clientProofRef?: string;

  @ApiPropertyOptional({
    description:
      '**Required for `ecesu`**: the `uploadId` of the issuer’s confirmation, uploaded ' +
      'first through `POST /me/bookings/{id}/cesu-proof/upload-url`. Kept privately as ' +
      'Lab’s Food’s evidence; the chef still confirms receipt. Optional on paper.',
    example: 'up_9f2a1c4e7b30d85a61c2e4f7',
  })
  @ValidateIf(
    (o: DeclareCesuPaymentDto) => o.medium === 'ecesu' || o.proofUploadId !== undefined,
  )
  @Matches(PROOF_UPLOAD_ID)
  proofUploadId?: string;
}

/** `POST /me/bookings/:id/cesu-proof/upload-url`: the issuer's confirmation, first. */
export class CesuProofUploadDto {
  @ApiProperty({ enum: ALLOWED_MIME_TYPES, example: 'application/pdf' })
  @IsIn(ALLOWED_MIME_TYPES)
  contentType!: string;

  @ApiProperty({ minimum: 1, maximum: MAX_FILE_BYTES, example: 182_311 })
  @IsInt()
  @Min(1)
  @Max(MAX_FILE_BYTES)
  sizeBytes!: number;
}

/** `PUT /me/cesu-payments/:id/proof`: another file, while the chef has not answered. */
export class CesuProofDto {
  @ApiProperty({
    description: 'The `uploadId` of the new upload link.',
    example: 'up_9f2a1c4e7b30d85a61c2e4f7',
  })
  @Matches(PROOF_UPLOAD_ID)
  uploadId!: string;
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
  @ApiProperty({
    example: '3d1f7a20-5b6c-4e8d-9f0a-1b2c3d4e5f60',
    format: 'uuid',
    description: 'Local `payments.id`.',
  })
  paymentId!: string;

  @ApiProperty({
    example: '9c3ebc99-9c0b-4ef8-bb6d-6bb9bd380a99',
    format: 'uuid',
    description: 'Booking paid.',
  })
  bookingId!: string;

  @ApiPropertyOptional({
    example: 'LF-2026-0142',
    nullable: true,
    description: 'Booking reference, when set.',
  })
  bookingReference?: string | null;

  @ApiProperty({
    example: 10000,
    description: 'Declared amount, VAT included, in minor units.',
  })
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

  @ApiPropertyOptional({
    enum: CESU_SUPPORTED_ISSUERS,
    nullable: true,
    description: 'Issuer.',
  })
  issuer?: CesuIssuer | null;

  @ApiProperty({
    enum: ['declared', 'confirmed', 'rejected'],
    description: 'Where the declaration stands with the chef.',
  })
  settlementStatus!: CesuSettlementStatus;

  @ApiPropertyOptional({
    example: 'PLX-2026-884213',
    nullable: true,
    description: 'Client-supplied issuer reference.',
  })
  clientProofRef?: string | null;

  @ApiPropertyOptional({
    example: '2026-10-17T09:12:03.412Z',
    nullable: true,
    type: String,
    format: 'date-time',
    description:
      'When the client uploaded the issuer’s confirmation; `null` for paper or an ' +
      'older declaration. The file itself is for Lab’s Food (`…/proof-url`).',
  })
  proofUploadedAt?: Date | null;

  @ApiPropertyOptional({
    example: null,
    nullable: true,
    type: String,
    format: 'date-time',
    description: 'When the chef (or an admin) confirmed receipt.',
  })
  confirmedAt?: Date | null;

  @ApiPropertyOptional({
    example: null,
    nullable: true,
    description: 'Why the chef rejected it.',
  })
  rejectionReason?: string | null;

  @ApiProperty({
    description: 'Whether an admin settled this instead of the chef.',
    example: false,
  })
  adminOverride!: boolean;

  @ApiPropertyOptional({
    example: 'Sophie Martin',
    nullable: true,
    description: 'Client display name.',
  })
  clientName?: string | null;

  @ApiPropertyOptional({
    example: 'Chef Marie',
    nullable: true,
    description: 'Chef display name.',
  })
  chefDisplayName?: string | null;

  @ApiProperty({
    example: '2026-10-17T09:10:00.000Z',
    type: String,
    format: 'date-time',
    description: 'Declaration time.',
  })
  declaredAt!: Date;
}

/**
 * `GET /me/bookings/:id/payment-status` — what is left to pay.
 *
 * Coverage counts **`succeeded` payments only**, which is what makes a booking split
 * between CESU and card work: the booking confirms when the parts add up.
 */
export class BookingPaymentStatusDto {
  @ApiProperty({ example: '9c3ebc99-9c0b-4ef8-bb6d-6bb9bd380a99', format: 'uuid' })
  bookingId!: string;

  @ApiProperty({
    example: 25500,
    description: 'Booking total, VAT included, in minor units.',
  })
  amountTtcCents!: number;

  @ApiProperty({
    example: 10000,
    description: 'Sum of settled payments, in minor units.',
  })
  coveredAmountCents!: number;

  @ApiProperty({
    example: 15500,
    description:
      'Amount still to pay, in minor units. A card intent is created for exactly this, ' +
      'and a CESU declaration may not exceed it.',
  })
  remainingAmountCents!: number;

  @ApiProperty({ description: 'ISO 4217 currency code.', example: 'EUR' })
  currency!: string;

  @ApiProperty({ example: false, description: 'Whether the booking is fully paid.' })
  fullyCovered!: boolean;

  @ApiProperty({
    example: true,
    description:
      'Whether prefinanced CESU is offered for this booking: platform NAN configured, ' +
      'batch cooker opted in, commission mandate active.',
  })
  cesuAvailable!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'The platform CRCESU affiliation number (NAN) the client pays on their issuer ' +
      'portal. Batch cookers no longer hold one.',
    example: '1234567',
  })
  payeeNan?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Who the client pays in CESU.',
    example: 'Lab’s Food',
  })
  payeeName?: string | null;
}

/**
 * Public, on purpose: whether a batch cooker can be paid in CESU, and the platform NAN
 * the client will pay (the client adds Lab’s Food, not the batch cooker, on their portal).
 */
export class ChefCesuInfoDto {
  @ApiProperty({
    example: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
    format: 'uuid',
    description: 'Chef profile id.',
  })
  chefProfileId!: string;

  @ApiProperty({ description: 'Chef display name.', example: 'Chef Marie D.' })
  chefDisplayName!: string;

  @ApiProperty({
    example: true,
    description: 'Whether the chef accepts prefinanced CESU.',
  })
  acceptsCesu!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'The platform CRCESU affiliation number (NAN) to enter on the issuer portal. ' +
      'Null when CESU is not offered.',
    example: '1234567',
  })
  payeeNan?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Who the client pays in CESU.',
    example: 'Lab’s Food',
  })
  payeeName?: string | null;

  @ApiProperty({
    example: ['pluxee', 'edenred', 'up'],
    enum: CESU_SUPPORTED_ISSUERS,
    isArray: true,
    description: 'Issuers a beneficiary can pay from. Informational — none is queryable.',
  })
  supportedIssuers!: CesuIssuer[];
}
