import { ApiProperty } from '@nestjs/swagger';

import { Booking, BookingStatus } from '../../../supabase/entities';

export class BookingReadDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  clientId!: string;

  @ApiProperty({ format: 'uuid' })
  providerId!: string;

  @ApiProperty({ format: 'uuid' })
  serviceOfferId!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  startsAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  endsAt!: Date;

  @ApiProperty({ enum: BookingStatus })
  status!: BookingStatus;

  @ApiProperty()
  priceCents!: number;

  @ApiProperty()
  currency!: string;

  static fromEntity(b: Booking): BookingReadDto {
    return {
      id: b.id,
      clientId: b.clientId,
      providerId: b.providerId,
      serviceOfferId: b.serviceOfferId,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      status: b.status,
      priceCents: b.priceCents,
      currency: b.currency,
    };
  }
}
