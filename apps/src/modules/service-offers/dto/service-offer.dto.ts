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
  ValidateIf,
} from 'class-validator';

import { QueryBoolean } from '../../../common/dto/query-boolean';

/** The slot an offer blocks when the chef gives no duration: the custom-quote length. */
export const DEFAULT_OFFER_MINUTES = 240;

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

  @ApiPropertyOptional({
    minimum: 30,
    maximum: 720,
    default: DEFAULT_OFFER_MINUTES,
    description:
      'Length of the visit. Only blocks the slot a client books; the offer card does ' +
      `not feature it. Omitted: ${DEFAULT_OFFER_MINUTES} minutes.`,
    example: 240,
  })
  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(720)
  durationMinutes?: number;

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

  @ApiProperty({
    minimum: 1,
    maximum: 20,
    description:
      'Dishes the offer includes, a fixed count: the client picks exactly that many ' +
      'and buys no extra dish. More dishes is a custom request, not an offer.',
    example: 3,
  })
  @IsInt()
  @Min(1)
  @Max(20)
  mealsIncluded!: number;

  @ApiPropertyOptional({
    default: true,
    description: 'Offered to clients. Turn off instead of deleting a booked offer.',
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateServiceOfferDto extends PartialType(CreateServiceOfferDto) {
  /** Optional, but never null: an offer cannot go back to « any count ». */
  @ApiPropertyOptional({ minimum: 1, maximum: 20, example: 3 })
  @ValidateIf((o: UpdateServiceOfferDto) => o.mealsIncluded !== undefined)
  @IsInt()
  @Min(1)
  @Max(20)
  mealsIncluded?: number;
}

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
