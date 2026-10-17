import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type {
  CommissionCollectionMethod,
  CommissionDebitStatus,
  CommissionInvoiceStatus,
  PaymentMethod,
} from '../../../generated/prisma/client';

/** One collection attempt against a facture B. N attempts may exist for one invoice. */
export class CommissionDebitDto {
  @ApiProperty({ example: '6a2f9e14-0b7c-4d3a-8e51-9c0d2b4f6a11', format: 'uuid' })
  id!: string;

  @ApiProperty({
    enum: ['pending', 'processing', 'succeeded', 'failed', 'canceled', 'reversed'],
    description:
      'SEPA never answers `succeeded` synchronously: a fresh debit sits in `processing` ' +
      'for about three business days. `reversed` is a CORE dispute.',
  })
  status!: CommissionDebitStatus;

  @ApiProperty({ description: 'Attempt number against this invoice.', example: 1 })
  attemptNumber!: number;

  @ApiProperty({
    example: 4200,
    description: 'Amount debited, VAT included, in minor units.',
  })
  amountTtcCents!: number;

  @ApiPropertyOptional({
    example: null,
    nullable: true,
    description: 'Why this attempt failed.',
  })
  failureReason?: string | null;

  @ApiPropertyOptional({
    example: '2026-10-01T06:00:05.000Z',
    nullable: true,
    type: String,
    format: 'date-time',
  })
  initiatedAt?: Date | null;

  @ApiPropertyOptional({
    example: null,
    nullable: true,
    type: String,
    format: 'date-time',
  })
  settledAt?: Date | null;

  @ApiPropertyOptional({
    example: null,
    nullable: true,
    type: String,
    format: 'date-time',
    description:
      'End of the 8-week SEPA CORE revocation window. Before this date the debit can ' +
      'still be reversed by the chef, no questions asked.',
  })
  clawbackWindowEndsAt?: Date | null;
}

/**
 * **Facture B** — the commission invoice the platform issues to the chef.
 *
 * This phase delivers the numbered receivable and its JSON. The rendered PDF and the
 * 10-year S3 archive belong to the invoicing workstream, which fills `pdfObjectKey` and
 * `s3ArchivedAt` without a further migration.
 *
 * ponytail: no PDF/S3 archive yet — columns are reserved (schema.prisma), just unfilled.
 * Same deferral as the fiscal attestation PDF. Build the invoicing workstream when needed.
 */
export class CommissionInvoiceDto {
  @ApiProperty({ example: '1f0e2d3c-4b5a-4987-8a6b-5c4d3e2f1a00', format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Invoice number.', example: 'LF-COM-2026-0007' })
  invoiceNumber!: string;

  @ApiProperty({
    example: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
    format: 'uuid',
    description: 'Chef billed.',
  })
  chefProfileId!: string;

  @ApiPropertyOptional({
    example: 'Chef Marie',
    nullable: true,
    description: 'Chef display name.',
  })
  chefDisplayName?: string | null;

  @ApiProperty({ example: '2026-10-01T06:00:00.000Z', type: String, format: 'date-time' })
  issuedAt!: Date;

  @ApiProperty({ description: 'Commission before VAT, in minor units.', example: 900 })
  amountHtCents!: number;

  @ApiProperty({ description: 'VAT on the commission, in minor units.', example: 180 })
  amountVatCents!: number;

  @ApiProperty({ description: 'Total billed, in minor units.', example: 1080 })
  amountTtcCents!: number;

  @ApiProperty({
    description: 'Commission rate applied, in basis points.',
    example: 1500,
  })
  rateBps!: number;

  @ApiProperty({ description: 'VAT rate applied, in basis points.', example: 2000 })
  vatRateBps!: number;

  @ApiProperty({
    enum: ['cb', 'avance_immediate', 'cesu'],
    description:
      'Underlying payment method — this is what says whether the commission was already ' +
      'withheld at charge time (`cb`) or is collected by direct debit (`cesu`).',
  })
  paymentMethod!: PaymentMethod;

  @ApiProperty({ enum: ['stripe_application_fee', 'sepa_direct_debit'] })
  collectionMethod!: CommissionCollectionMethod;

  @ApiProperty({
    enum: ['issued', 'settled', 'written_off'],
    description:
      '`issued` is due. A failed debit does **not** change it — the receivable survives ' +
      'the attempt, which is why invoice numbers never develop holes.',
  })
  status!: CommissionInvoiceStatus;

  @ApiPropertyOptional({
    example: '2026-09-01T00:00:00.000Z',
    nullable: true,
    type: String,
    format: 'date-time',
    description: 'Set only on a `monthly_batch` invoice.',
  })
  periodStart?: Date | null;

  @ApiPropertyOptional({
    example: '2026-09-30T23:59:59.999Z',
    nullable: true,
    type: String,
    format: 'date-time',
  })
  periodEnd?: Date | null;

  @ApiProperty({ description: 'Commission lines billed on this invoice.', example: 1 })
  commissionsCount!: number;

  @ApiProperty({
    type: CommissionDebitDto,
    isArray: true,
    description: 'Attempts, newest last.',
  })
  debits!: CommissionDebitDto[];
}

/** `POST /admin/commission-invoices/run-due` result. */
export class RunDueInvoicesResultDto {
  @ApiProperty({ description: 'Invoices cut by this run.', example: 4 })
  invoicesIssued!: number;

  @ApiProperty({ description: 'Debits actually sent to Stripe.', example: 4 })
  debitsStarted!: number;

  @ApiProperty({
    example: ['LF-COM-2026-0042'],
    isArray: true,
    type: String,
    description: 'Numbers issued.',
  })
  invoiceNumbers!: string[];

  @ApiProperty({
    description:
      'True when another instance held the advisory lock and this run did nothing. ' +
      'Railway may run several instances; the batch is not allowed to double-invoice.',
    example: false,
  })
  skippedBecauseLocked!: boolean;
}
