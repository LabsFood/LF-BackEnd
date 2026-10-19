import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { QueryBoolean } from '../../../common/dto/query-boolean';

export class CreateServiceOfferDto {
  @ApiProperty({ minLength: 1, maxLength: 160, example: 'Session 4 heures' })
  @IsString()
  @Length(1, 160)
  name!: string;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiProperty({
    minimum: 30,
    maximum: 720,
    description: 'Length of the visit. It sets the slot a client books.',
    example: 240,
  })
  @IsInt()
  @Min(30)
  @Max(720)
  durationMinutes!: number;

  @ApiProperty({
    minimum: 1,
    maximum: 1_000_000,
    description: 'Base price, in cents, before commission.',
    example: 18000,
  })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  priceCents!: number;

  @ApiPropertyOptional({
    default: false,
    description: 'The batch cooker does the shopping for this offer.',
  })
  @IsOptional()
  @IsBoolean()
  shoppingIncluded?: boolean;

  @ApiPropertyOptional({
    default: 0,
    minimum: 0,
    maximum: 100_000,
    description: 'Shopping fee, in cents. Must stay 0 unless `shoppingIncluded`.',
    example: 1500,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  shoppingFeeCents?: number;

  @ApiPropertyOptional({
    default: true,
    description: 'Offered to clients. Turn off instead of deleting a booked offer.',
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateServiceOfferDto extends PartialType(CreateServiceOfferDto) {}

/** `GET /service-offers/{id}/price`: what the client would book. */
export class OfferPriceQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 50, description: 'Adults.', example: 4 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  persons?: number;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 20,
    default: 0,
    description: 'Extra dishes beyond what the offer covers (the "Plats supp." counter).',
    example: 2,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  extraMeals?: number;

  @ApiPropertyOptional({
    default: false,
    description: 'The client does the shopping: no shopping fee.',
  })
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  shoppingByClient?: boolean;
}
