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
  IsUrl,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { ALLERGEN_CODES, DIET_CODES, DISH_CATEGORY_CODES } from '../domain/dishes.rules';
import { DECLARED_DIET_CODES } from '../domain/classification.rules';
import { STEP_TYPE_CODES } from '../domain/recipes.rules';

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

  @ApiPropertyOptional({
    maxLength: 512,
    nullable: true,
    description: 'Where to buy it, or what it is: an `http` or `https` address.',
    example: 'https://www.example.com/poulet-fermier',
  })
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(512)
  link?: string | null;

  @ApiPropertyOptional({
    default: false,
    description:
      'The chef still has to check this line (an imported or generated recipe). ' +
      'A line to verify keeps the recipe from being ready.',
  })
  @IsOptional()
  @IsBoolean()
  toVerify?: boolean;

  @ApiPropertyOptional({
    default: false,
    description:
      'The quantity stays the same whatever the portions (a bay leaf, a pinch of ' +
      'salt) (§4.12).',
  })
  @IsOptional()
  @IsBoolean()
  fixedQuantity?: boolean;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'The entry of the common ingredient list (`GET /ingredients?search=`) this line ' +
      'is. Diets and seasons are computed from linked lines only.',
  })
  @IsOptional()
  @IsUUID()
  catalogIngredientId?: string | null;
}

/**
 * One step of a recipe (Recettes §4.5). The order is the position in the list: an
 * `order` sent back as read is accepted and ignored.
 */
export class StepDto {
  @ApiPropertyOptional({ description: 'Ignored: the position in the list is the order.' })
  @IsOptional()
  @IsInt()
  order?: number;

  @ApiProperty({ maxLength: 2000, example: 'Préchauffer le four à 200 °C.' })
  @IsString()
  @Length(1, 4000)
  text!: string;

  @ApiPropertyOptional({
    enum: STEP_TYPE_CODES,
    nullable: true,
    description:
      'Labels in `GET /referentials/step-types`. A step without a type keeps the ' +
      'recipe from being ready.',
    example: 'cuisson',
  })
  @IsOptional()
  @IsIn(STEP_TYPE_CODES)
  type?: string | null;

  @ApiPropertyOptional({ minimum: 0, maximum: 1440, nullable: true, example: 55 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  durationMinutes?: number | null;
}

/**
 * Recettes §4.6. Changing it never makes a new recipe version and never asks for
 * the allergens to be verified again, even on a published dish.
 */
export class ReheatingDto {
  @ApiPropertyOptional({
    type: [String],
    description:
      'Codes from `GET /referentials/reheat-modes`, the list the console edits.',
    example: ['oven', 'microwave'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @Length(1, 40, { each: true })
  modes?: string[];

  @ApiPropertyOptional({
    maxLength: 40,
    deprecated: true,
    description: 'One mode, as before `modes`: read as `modes: [mode]`.',
    example: 'oven',
  })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  mode?: string;

  @ApiPropertyOptional({ description: 'Degrees Celsius.', example: 160 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(300)
  temperature?: number;

  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(600)
  minutes?: number | null;

  @ApiPropertyOptional({
    maxLength: 300,
    description: 'The instructions, as free text.',
    example: "Couvrir d'un papier cuisson.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;

  @ApiPropertyOptional({
    maxLength: 120,
    nullable: true,
    description: 'The container advised to reheat in.',
    example: 'Plat en verre',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  container?: string | null;
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
  // The caps (60 ingredients, 40 steps of 2,000 characters) answer 422
  // LIMIT_REACHED from the service; these bounds only stop an oversized body.
  @ApiProperty({ type: [IngredientDto], description: 'At most 60.' })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => IngredientDto)
  ingredients!: IngredientDto[];

  @ApiProperty({
    type: [StepDto],
    description: 'In order. At most 40, of 2,000 characters each.',
  })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => StepDto)
  steps!: StepDto[];

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
    type: [String],
    description:
      'Equipment the recipe needs, as free text. Optional, never checked (Recettes ' +
      '§4.7).',
    example: ['Cocotte en fonte'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString(FREE_TEXT)
  @Length(1, 60, FREE_TEXT)
  equipment?: string[];

  @ApiPropertyOptional({
    enum: DECLARED_DIET_CODES,
    isArray: true,
    description:
      'Recettes §4.8: the diets the chef declares, the ones ingredients cannot prove ' +
      '(halal, kosher). The others are computed from the common ingredient list.',
    example: ['halal'],
  })
  @IsOptional()
  @IsArray()
  @IsIn(DECLARED_DIET_CODES, FREE_TEXT)
  declaredDiets?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Codes from `GET /referentials/recipe-profiles`.',
    example: ['budget'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString(FREE_TEXT)
  @Length(1, 40, FREE_TEXT)
  profiles?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Your own tags, to sort your dishes. Never shown to clients.',
    example: ['été', 'rapide'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString(FREE_TEXT)
  @Length(1, 30, FREE_TEXT)
  personalTags?: string[];

  @ApiPropertyOptional({
    type: [Number],
    description:
      'Months in season, 1 to 12, set instead of the computed ones. `[]` to go back ' +
      'to the computed seasons.',
    example: [6, 7, 8],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsInt(FREE_TEXT)
  @Min(1, FREE_TEXT)
  @Max(12, FREE_TEXT)
  seasonsOverride?: number[];

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
