import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO31661Alpha2,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { ALLERGEN_CODES, DIET_CODES, DISH_CATEGORY_CODES } from '../domain/dishes.rules';

const DIFFICULTIES = ['easy', 'medium', 'hard'];

/**
 * One line of a recipe, for `portions` portions. The shape shopping lists read:
 * anything else would never reach a prestation's list.
 */
export class IngredientDto {
  @ApiProperty({ maxLength: 120, example: 'Poulet fermier entier' })
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiProperty({
    minimum: 0,
    description: 'Quantity for the dish’s portions.',
    example: 1.4,
  })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(100000)
  qty!: number;

  @ApiProperty({
    maxLength: 32,
    description: 'Free text: `g`, `kg`, `gousse`…',
    example: 'kg',
  })
  @IsString()
  @Length(1, 32)
  unit!: string;

  @ApiProperty({
    maxLength: 60,
    description: 'Shop aisle, used to group the shopping list.',
    example: 'boucherie',
  })
  @IsString()
  @Length(1, 60)
  aisle!: string;
}

export class ReheatingDto {
  @ApiProperty({ maxLength: 40, example: 'oven' })
  @IsString()
  @Length(1, 40)
  mode!: string;

  @ApiPropertyOptional({ description: 'Degrees Celsius.', example: 160 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(300)
  temperature?: number;

  @ApiProperty({ example: 15 })
  @IsInt()
  @Min(0)
  @Max(600)
  minutes!: number;

  @ApiPropertyOptional({ maxLength: 300, example: "Couvrir d'un papier cuisson." })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class StorageDto {
  @ApiProperty({ maxLength: 40, example: 'fridge' })
  @IsString()
  @Length(1, 40)
  method!: string;

  @ApiProperty({ description: 'How many days it keeps.', example: 3 })
  @IsInt()
  @Min(0)
  @Max(365)
  days!: number;

  @ApiPropertyOptional({ maxLength: 120, example: 'Boîte hermétique' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  container?: string;
}

/**
 * The chef's craft: never shown on the public site, handed to the client on the
 * fiche after the prestation (FLOW-02 §1, §8).
 */
export class RecipeDto {
  @ApiProperty({ type: [IngredientDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => IngredientDto)
  ingredients!: IngredientDto[];

  @ApiProperty({
    type: [String],
    example: ['Préchauffer le four à 200 °C.', 'Enfourner 55 min.'],
  })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  steps!: string[];

  @ApiPropertyOptional({ type: ReheatingDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => ReheatingDto)
  reheating?: ReheatingDto | null;

  @ApiPropertyOptional({ type: StorageDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => StorageDto)
  storage?: StorageDto | null;
}

const FREE_TEXT = { each: true } as const;

export class CreateDishDto {
  @ApiProperty({ maxLength: 255, example: 'Poulet rôti aux herbes' })
  @IsString()
  @Length(1, 255)
  name!: string;

  @ApiPropertyOptional({
    maxLength: 2000,
    example: 'Poulet fermier rôti, thym et romarin, pommes de terre grenaille.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({
    description:
      'Country of origin, ISO 3166 alpha-2. Required to publish: it colours the ' +
      "client's culinary map.",
    example: 'FR',
  })
  @IsOptional()
  @IsISO31661Alpha2()
  country?: string | null;

  @ApiPropertyOptional({
    enum: DISH_CATEGORY_CODES,
    description: 'Labels in `GET /referentials/dish-categories`.',
    example: 'main',
  })
  @IsOptional()
  @IsIn(DISH_CATEGORY_CODES)
  category?: string | null;

  @ApiPropertyOptional({ minimum: 1, default: 4, example: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  portions?: number;

  @ApiProperty({ minimum: 0, description: 'Preparation time, in minutes.', example: 20 })
  @IsInt()
  @Min(0)
  @Max(1440)
  prepMinutes!: number;

  @ApiPropertyOptional({
    minimum: 0,
    description: 'Cooking time, in minutes.',
    example: 55,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  cookMinutes?: number | null;

  @ApiPropertyOptional({ enum: DIFFICULTIES, example: 'easy' })
  @IsOptional()
  @IsIn(DIFFICULTIES)
  difficulty?: 'easy' | 'medium' | 'hard' | null;

  @ApiPropertyOptional({
    enum: DIET_CODES,
    isArray: true,
    description:
      'Labels in `GET /referentials/diets`. Anything else goes in `customDiets`.',
    example: ['lactose-free'],
  })
  @IsOptional()
  @IsArray()
  @IsIn(DIET_CODES, FREE_TEXT)
  diets?: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Diets outside the list (the "Autre" button). Shown as typed, and flagged to ' +
      'admins so a recurring one can join the list.',
    example: [],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString(FREE_TEXT)
  @Length(1, 40, FREE_TEXT)
  customDiets?: string[];

  @ApiPropertyOptional({
    enum: ALLERGEN_CODES,
    isArray: true,
    description:
      'Which of the 14 regulated allergens the dish contains. Labels in ' +
      '`GET /referentials/allergens`.',
    example: ['celery'],
  })
  @IsOptional()
  @IsArray()
  @IsIn(ALLERGEN_CODES, FREE_TEXT)
  allergens?: string[];

  @ApiPropertyOptional({
    default: false,
    description:
      '`true` to declare that the dish contains **none** of the 14 regulated ' +
      'allergens. An empty `allergens` list alone does not say that, and cannot be ' +
      'published.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  allergensNone?: boolean;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Other allergens, as free text. They never replace the answer about the 14 ' +
      'regulated ones.',
    example: ['sarrasin'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString(FREE_TEXT)
  @Length(1, 40, FREE_TEXT)
  customAllergens?: string[];

  @ApiPropertyOptional({
    type: RecipeDto,
    description: 'Optional to publish; needed for the fiche and the shopping list.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => RecipeDto)
  recipe?: RecipeDto;
}

export class UpdateDishDto extends PartialType(CreateDishDto) {}
