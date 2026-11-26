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

  @ApiPropertyOptional({
    description:
      'You bring it (salt, oil…): the client does not buy it and cannot tick it. ' +
      'Absent: the line keeps what it has (your pantry staples set it on a new ' +
      'list). Survives every recalculation, like your other corrections.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  providedByChef?: boolean;
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

  @ApiPropertyOptional({
    nullable: true,
    example: 200,
    description:
      '« J’en ai une partie »: how much you have, in the unit of the line. Below the ' +
      'quantity: the batch cooker buys the rest (`toBuyQty`); the whole quantity or ' +
      'more: same as `alreadyHave: true`. Zero, negative or on a line without ' +
      'quantity: `422 VALIDATION_FAILED`. Ignored when `alreadyHave` is true.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Max(100000)
  haveQty?: number | null;
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

export class ShoppingReplyDto {
  @ApiProperty({ maxLength: 120, example: 'Sel fin' })
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiProperty({ maxLength: 32, example: 'g' })
  @IsString()
  @Length(0, 32)
  unit!: string;

  @ApiProperty({
    nullable: true,
    maxLength: 280,
    example: 'Pas trouvé en bio, je prends le classique.',
    description: 'Your answer to the comment on this line; `null` or blank clears it.',
  })
  @ValidateIf((reply: ShoppingReplyDto) => reply.reply !== null)
  @IsString()
  @MaxLength(280)
  reply!: string | null;
}

export class PatchShoppingRepliesDto {
  @ApiProperty({ type: [ShoppingReplyDto] })
  @IsArray()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => ShoppingReplyDto)
  replies!: ShoppingReplyDto[];
}

export class PutPantryStaplesDto {
  @ApiProperty({
    type: [String],
    maxItems: 100,
    example: ['Sel fin', 'Poivre', 'Huile d’olive'],
    description:
      'Everything you always bring, as you name it. Replaces the list. Matched to ' +
      'the shopping lines by name, case and accents aside.',
  })
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @Length(1, 120, { each: true })
  staples!: string[];
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
