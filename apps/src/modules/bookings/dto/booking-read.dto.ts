import { ApiProperty } from '@nestjs/swagger';

import { Booking, BookingStatus } from '../../../supabase/entities';

export class BookingReadDto {
  @ApiProperty({
    format: 'uuid',
    description: 'The booking id.',
    example: '7b1ebc99-9c0b-4ef8-bb6d-6bb9bd380a88',
  })
  id!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'The account of the client who booked.',
    example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  })
  clientId!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'The batch cooker page id. Old name of `chefId`, same value.',
    example: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
  })
  providerId!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'The batch cooker page id. Prefer this name to `providerId`.',
    example: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
  })
  chefId!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'The service offer booked.',
    example: '9c3ebc99-9c0b-4ef8-bb6d-6bb9bd380a99',
  })
  serviceOfferId!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Scheduled service start (ISO 8601).',
    example: '2026-07-15T18:00:00.000Z',
  })
  startsAt!: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Scheduled service end (ISO 8601). Must be after `startsAt` on create.',
    example: '2026-07-15T20:00:00.000Z',
  })
  endsAt!: Date;

  @ApiProperty({
    enum: ['pending', 'confirmed', 'completed', 'cancelled'],
    description:
      '`pending`: waiting for confirmation. `confirmed`: going ahead. `completed`: done. ' +
      '`cancelled`: will not happen.',
    example: 'confirmed',
  })
  status!: BookingStatus;

  @ApiProperty({
    description: 'Total price in minor currency units (e.g. cents).',
    example: 12500,
  })
  priceCents!: number;

  @ApiProperty({
    description: 'ISO 4217 currency code.',
    example: 'EUR',
  })
  currency!: string;

  @ApiProperty({
    nullable: true,
    description: 'Human-readable booking reference, `LF-<year>-NNNN`.',
    example: 'LF-2026-0001',
  })
  reference!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Amount charged to the client, VAT included, in minor units.',
    example: 12500,
  })
  amountTtc!: number | null;

  @ApiProperty({
    nullable: true,
    description:
      'Net cost to the client after the 50 % "service à la personne" tax credit.',
    example: 6250,
  })
  amountAfterTax!: number | null;

  static fromEntity(b: Booking): BookingReadDto {
    return {
      id: b.id,
      clientId: b.clientId,
      providerId: b.chefProfileId,
      chefId: b.chefProfileId,
      serviceOfferId: b.serviceOfferId,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      status: b.status,
      priceCents: b.priceCents,
      currency: b.currency,
      reference: b.reference,
      amountTtc: b.amountTtc,
      amountAfterTax: b.amountAfterTax,
    };
  }
}
