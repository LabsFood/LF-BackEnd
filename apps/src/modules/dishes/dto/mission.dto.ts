import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  ValidateIf,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class RecipeSheetQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 100,
    description: 'Portions to scale the recipe to. Default: those booked.',
    example: 4,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  portions?: number;
}

export class ShoppingLineDto {
  @ApiProperty({ maxLength: 120, example: 'Ail' })
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiProperty({ minimum: 0, example: 6 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(100000)
  qty!: number;

  @ApiProperty({ maxLength: 32, example: 'gousse' })
  @IsString()
  @Length(0, 32)
  unit!: string;

  @ApiProperty({ maxLength: 60, example: 'fruits-legumes' })
  @IsString()
  @Length(1, 60)
  aisle!: string;
}

export class PutShoppingListDto {
  @ApiProperty({
    type: [ShoppingLineDto],
    description:
      'The whole list as the batch cooker wants it. Lines that differ from the ' +
      'recipes are kept as corrections; a computed line left out is struck out.',
  })
  @IsArray()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => ShoppingLineDto)
  lines!: ShoppingLineDto[];
}

export class ShoppingMarkDto {
  @ApiProperty({ maxLength: 120, example: 'Ail' })
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiProperty({ maxLength: 32, example: 'gousse' })
  @IsString()
  @Length(0, 32)
  unit!: string;

  @ApiProperty({ description: 'I already have it: the batch cooker does not buy it.' })
  @IsBoolean()
  alreadyHave!: boolean;

  @ApiPropertyOptional({ maxLength: 280, example: 'De l’ail rose si possible' })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  comment?: string;
}

export class SubmitShoppingListDto {
  @ApiProperty({
    minimum: 0,
    example: 1,
    description:
      'The `version` of the list on screen. If the batch cooker has sent a newer one ' +
      'since, the answer is refused (`SHOPPING_LIST_UPDATED`): reload and check it.',
  })
  @IsInt()
  @Min(0)
  version!: number;

  @ApiProperty({
    type: [ShoppingMarkDto],
    description:
      'The lines you already have or comment, each once, named as on the list. The ' +
      'others are bought as listed. An empty list means: buy everything.',
  })
  @IsArray()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => ShoppingMarkDto)
  marks!: ShoppingMarkDto[];
}

export class PutDishNotesDto {
  @ApiPropertyOptional({
    nullable: true,
    maxLength: 500,
    description:
      'How to reheat this dish as cooked in this prestation. Absent: unchanged; ' +
      'blank or null: cleared.',
    example: 'Four à 160 °C pendant 15 min, film retiré.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reheatingNote?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: 500,
    description:
      'How to keep this dish as cooked in this prestation. Absent: unchanged; ' +
      'blank or null: cleared.',
    example: 'Réfrigérateur, 3 jours maximum.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  storageNote?: string | null;
}

/** Recettes lot 3 (LF-0270): the « à manger avant » date of a dish of a prestation. */
export class PutEatBeforeDto {
  @ApiProperty({
    nullable: true,
    type: String,
    format: 'date',
    description:
      'A Paris calendar day, `YYYY-MM-DD`, from the prestation day to 366 days after. ' +
      '`null`: back to the platform’s date (prestation day + the fridge days of the ' +
      'recipe).',
    example: '2026-11-23',
  })
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date!: string | null;
}

/** Recettes lot 4 (LF-0284): the batch cooker confirms the groceries are done. */
export class ValidateGroceriesDto {
  @ApiPropertyOptional({
    nullable: true,
    minimum: 0,
    maximum: 500_000,
    description:
      'The receipt total, in cents. Optional, for information only: no payment is ' +
      'taken before lot 6. Absent or null: no amount (an amount typed earlier is ' +
      'cleared).',
    example: 6480,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(500_000)
  amountCents?: number | null;
}
