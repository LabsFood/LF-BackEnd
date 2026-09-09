import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';

export class CreateBookingDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  providerId!: string;

  @ApiProperty({
    format: 'uuid',
    required: false,
    description:
      'Preferred API field name for Phase 1+ (`providerId` remains accepted for compatibility).',
  })
  @IsOptional()
  @IsUUID()
  chefId?: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  serviceOfferId!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  @Type(() => Date)
  @IsDate()
  startsAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  @Type(() => Date)
  @IsDate()
  endsAt!: Date;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  priceCents!: number;

  @ApiProperty({ default: 'EUR', minLength: 3, maxLength: 3 })
  @IsString()
  @Length(3, 3)
  currency: string = 'EUR';
}
