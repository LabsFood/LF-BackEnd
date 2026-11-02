import { ApiProperty } from '@nestjs/swagger';

/**
 * **Facture A** — the invoice the client receives for a card payment, issued in the
 * chef's name. Not to be confused with facture B (`CommissionInvoiceDto`), which the
 * platform issues to the chef.
 */
export class PaymentInvoiceDto {
  @ApiProperty({ example: '0b6c2f3e-8d41-4a7a-9c15-2e7f4d1a6b90', format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'LF-FAC-2026-0007', description: '`<prefix>-<year>-NNNN`.' })
  invoiceNumber!: string;

  @ApiProperty({
    example: '2026-11-02T10:00:00.000Z',
    type: String,
    format: 'date-time',
    description: 'The payment date: the invoice is issued when the card is charged.',
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
      'https://<project>.supabase.co/storage/v1/object/sign/labsfood-invoices/clients/…/LF-FAC-2026-0007.pdf?token=eyJhbGciOi…&download=facture-LF-FAC-2026-0007.pdf',
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
