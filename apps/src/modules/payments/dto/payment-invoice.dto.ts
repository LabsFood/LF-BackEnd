import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * **Facture A** — the invoice the client receives for a card payment, issued in the
 * chef's name. Not to be confused with facture B (`CommissionInvoiceDto`), which the
 * platform issues to the chef.
 */
export class PaymentInvoiceDto {
  @ApiProperty({ example: '0b6c2f3e-8d41-4a7a-9c15-2e7f4d1a6b90', format: 'uuid' })
  id!: string;

  @ApiProperty({
    example: 'LF-CUS26-00007',
    description:
      '`PAYMENTS_INVOICE_PREFIX` filled in: `YY` the year, the run of `X` the sequence.',
  })
  invoiceNumber!: string;

  @ApiProperty({
    example: '2026-11-02T10:00:00.000Z',
    type: String,
    format: 'date-time',
    description:
      'When the invoice was issued: the payment date for an invoice issued when the card ' +
      'was charged, the catch-up date for a payment settled before invoices existed.',
  })
  issuedAt!: Date;

  @ApiProperty({ example: 20000, description: 'Amount paid, VAT included, in cents.' })
  amountTtcCents!: number;

  @ApiProperty({ example: 'EUR' })
  currency!: string;

  @ApiProperty({ example: 'a0ee2b6c-1f3d-4e5a-9b7c-8d6e5f4a3b21', format: 'uuid' })
  bookingId!: string;

  @ApiProperty({ example: 'LF-2026-0042', nullable: true, type: String })
  bookingReference!: string | null;

  @ApiProperty({
    example: 'Chef Amina',
    description: 'The chef the invoice is issued for.',
  })
  chefDisplayName!: string;

  @ApiProperty({
    example: true,
    description:
      'Whether the PDF is already stored. `false` is not an error: the download route ' +
      'draws and stores it on the spot.',
  })
  pdfReady!: boolean;
}

/** A short-lived signed link to a private document. */
export class DocumentLinkDto {
  @ApiProperty({
    example:
      'https://<project>.supabase.co/storage/v1/object/sign/labsfood-invoices/clients/…/LF-CUS26-00007.pdf?token=eyJhbGciOi…&download=facture-LF-CUS26-00007.pdf',
  })
  url!: string;

  @ApiProperty({
    example: '2026-11-02T10:05:00.000Z',
    type: String,
    format: 'date-time',
    description: 'The link stops working after this instant (5 minutes).',
  })
  expiresAt!: Date;
}

export class BackfillPaymentInvoicesDto {
  @ApiPropertyOptional({
    default: true,
    description: 'Report what would be invoiced without issuing. Pass `false` to issue.',
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

class BackfilledInvoiceDto {
  @ApiProperty({ format: 'uuid' })
  paymentId!: string;

  @ApiProperty({ example: 'LF-CUS26-00001' })
  invoiceNumber!: string;
}

class BackfillFailureDto {
  @ApiProperty({ format: 'uuid' })
  paymentId!: string;

  @ApiProperty({
    example: 'INVOICE_AMOUNT_INVALID',
    description: 'Error code, or `P2002`.',
  })
  code!: string;
}

export class PaymentInvoiceBackfillResultDto {
  @ApiProperty()
  dryRun!: boolean;

  @ApiProperty({ example: 12, description: 'Settled card payments that had no invoice.' })
  pending!: number;

  @ApiProperty({ type: BackfilledInvoiceDto, isArray: true })
  issued!: BackfilledInvoiceDto[];

  @ApiProperty({ type: BackfillFailureDto, isArray: true })
  failed!: BackfillFailureDto[];
}
