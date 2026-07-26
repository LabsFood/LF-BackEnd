import { ApiProperty } from '@nestjs/swagger';

import { Booking, BookingStatus } from '../../../supabase/entities';

export class BookingReadDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Booking primary key.',
    example: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
  })
  id!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Postgres user id of the client who placed the booking.',
  })
  clientId!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Chef profile id assigned to the booking (legacy field name: provider).',
  })
  providerId!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Alias of `providerId` — preferred name in Phase 1+ responses.',
  })
  chefId!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Service offer (menu package) booked by the client.',
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
    enum: BookingStatus,
    description: 'Booking lifecycle status.',
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
    };
  }
}
