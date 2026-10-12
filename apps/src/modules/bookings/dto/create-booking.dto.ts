import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';

export class CreateBookingDto {
  @ApiProperty({
    format: 'uuid',
    description: 'The batch cooker page id. Old name of `chefId`; still required.',
    example: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
  })
  @IsUUID()
  providerId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'The batch cooker page id, same value as `providerId`.',
    example: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
  })
  @IsOptional()
  @IsUUID()
  chefId?: string;

  @ApiProperty({
    format: 'uuid',
    description: 'The service offer to book.',
    example: '9c3ebc99-9c0b-4ef8-bb6d-6bb9bd380a99',
  })
  @IsUUID()
  serviceOfferId!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'When the in-home service should start.',
    example: '2026-07-15T18:00:00.000Z',
  })
  @Type(() => Date)
  @IsDate()
  startsAt!: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description:
      'When the in-home service should end. Must be strictly after `startsAt`.',
    example: '2026-07-15T20:00:00.000Z',
  })
  @Type(() => Date)
  @IsDate()
  endsAt!: Date;

  @ApiProperty({
    minimum: 0,
    description: 'Quoted price in minor currency units (e.g. cents).',
    example: 12500,
  })
  @IsInt()
  @Min(0)
  priceCents!: number;

  @ApiProperty({
    default: 'EUR',
    minLength: 3,
    maxLength: 3,
    description: 'ISO 4217 currency code.',
    example: 'EUR',
  })
  @IsString()
  @Length(3, 3)
  currency: string = 'EUR';
}
