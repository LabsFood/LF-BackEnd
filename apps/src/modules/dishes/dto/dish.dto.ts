import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO31661Alpha2,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { Raw } from '../../../common/dto/strict';
import { oneLine } from '../../../common/dto/clean-text';
import { UNIT_CODES } from '../domain/units.rules';
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
  @Raw()
  @Transform(oneLine)
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 100000,
    nullable: true,
    description:
      'Quantity for the dish’s portions, strictly above 0, at most 3 decimals. `null` only ' +
      'with `to_taste` or on a line to verify.',
    example: 1.4,
  })
  @IsOptional()
  @Raw()
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  @Max(100000)
  qty?: number | null;

  @ApiPropertyOptional({
    enum: UNIT_CODES,
    nullable: true,
    description:
      'One of the 14 fixed units (`GET /referentials/units`). `null` only on a line ' +
      'to verify.',
    example: 'kg',
  })
  @IsOptional()
  @Raw()
  @IsIn(UNIT_CODES)
  unit?: string | null;

  @ApiPropertyOptional({
    maxLength: 60,
    description:
      'Shop aisle. Ignored on a linked line: the API takes the ingredient’s own.',
    example: 'boucherie',
  })
  @IsOptional()
  @Raw()
  @IsString()
  @Length(1, 60)
  aisle?: string;

  @ApiPropertyOptional({
    maxLength: 512,
    nullable: true,
    description: 'Where to buy it, or what it is: an `http` or `https` address.',
    example: 'https://www.example.com/poulet-fermier',
  })
  @IsOptional()
  @Raw()
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
  @Raw()
  @IsBoolean()
  toVerify?: boolean;

  @ApiPropertyOptional({
    default: false,
    description:
      'The quantity stays the same whatever the portions (a bay leaf, a pinch of ' +
      'salt) (§4.12).',
  })
  @IsOptional()
  @Raw()
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
  @Raw()
  @IsUUID()
  catalogIngredientId?: string | null;

  @ApiPropertyOptional({
    default: false,
    description:
      'The line may be left out: its allergens are then only conditional on the dish.',
  })
  @IsOptional()
  @Raw()
  @IsBoolean()
  optional?: boolean;

  @ApiPropertyOptional({ maxLength: 60, nullable: true, example: 'bio' })
  @IsOptional()
  @Raw()
  @Transform(oneLine)
  @IsString()
  @MaxLength(60)
  precision?: string | null;

  @ApiPropertyOptional({ maxLength: 120, nullable: true, example: 'en dés' })
  @IsOptional()
  @Raw()
  @Transform(oneLine)
  @IsString()
  @MaxLength(120)
  preparation?: string | null;

  @ApiPropertyOptional({
    maxLength: 60,
    nullable: true,
    description: 'The sub-recipe the line belongs to, e.g. "Sauce".',
    example: 'Sauce',
  })
  @IsOptional()
  @Raw()
  @Transform(oneLine)
  @IsString()
  @MaxLength(60)
  group?: string | null;

  @ApiPropertyOptional({
    default: false,
    description: 'Kept on the chef’s fiche, left off the client’s.',
  })
  @IsOptional()
  @Raw()
  @IsBoolean()
  hiddenFromClient?: boolean;

  @ApiPropertyOptional({
    maxLength: 200,
    nullable: true,
    description: 'The original text of a line to verify.',
    example: '2 gousses d’ail',
  })
  @IsOptional()
  @Raw()
  @Transform(oneLine)
  @IsString()
  @MaxLength(200)
  rawText?: string | null;
}

/**
 * One step of a recipe (Recettes §4.5). The order is the position in the list: an
 * `order` sent back as read is accepted and ignored.
 */
export class StepDto {
  @ApiPropertyOptional({ description: 'Ignored: the position in the list is the order.' })
  @IsOptional()
  @Raw()
  @IsInt()
  order?: number;

  @ApiProperty({ maxLength: 2000, example: 'Préchauffer le four à 200 °C.' })
  @Raw()
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
  @Raw()
  @IsIn(STEP_TYPE_CODES)
  type?: string | null;

  @ApiPropertyOptional({ minimum: 0, maximum: 1440, nullable: true, example: 55 })
  @IsOptional()
  @Raw()
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
  @Raw()
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
  @Raw()
  @IsString()
  @Length(1, 40)
  mode?: string;

  @ApiPropertyOptional({ description: 'Degrees Celsius.', example: 160 })
  @IsOptional()
  @Raw()
  @IsInt()
  @Min(0)
  @Max(300)
  temperature?: number;

  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  @Raw()
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
  @Raw()
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
  @Raw()
  @IsString()
  @MaxLength(120)
  container?: string | null;
}

export class StorageDto {
  @ApiProperty({ maxLength: 40, example: 'fridge' })
  @Raw()
  @IsString()
  @Length(1, 40)
  method!: string;

  @ApiProperty({ description: 'How many days it keeps.', example: 3 })
  @Raw()
  @IsInt()
  @Min(0)
  @Max(365)
  days!: number;

  @ApiPropertyOptional({ maxLength: 120, example: 'Boîte hermétique' })
  @IsOptional()
  @Raw()
  @IsString()
  @MaxLength(120)
  container?: string;

  @ApiPropertyOptional({ default: false, description: 'It can go in the freezer.' })
  @IsOptional()
  @Raw()
  @IsBoolean()
  freezable?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 24, nullable: true, example: 3 })
  @IsOptional()
  @Raw()
  @IsInt()
  @Min(1)
  @Max(24)
  freezerMonths?: number | null;

  @ApiPropertyOptional({
    maxLength: 300,
    nullable: true,
    description: 'How to thaw it.',
    example: 'Une nuit au réfrigérateur.',
  })
  @IsOptional()
  @Raw()
  @IsString()
  @MaxLength(300)
  thawing?: string | null;
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
  @Raw()
  @IsString()
  @Length(1, 255)
  name!: string;

  @ApiPropertyOptional({
    maxLength: 2000,
    example: 'Poulet fermier rôti, thym et romarin, pommes de terre grenaille.',
  })
  @IsOptional()
  @Raw()
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
  @Raw()
  @IsISO31661Alpha2()
  country?: string | null;

  @ApiPropertyOptional({
    enum: DISH_CATEGORY_CODES,
    description: 'Labels in `GET /referentials/dish-categories`.',
    example: 'main',
  })
  @IsOptional()
  @Raw()
  @IsIn(DISH_CATEGORY_CODES)
  category?: string | null;

  @ApiPropertyOptional({ minimum: 1, default: 4, example: 3 })
  @IsOptional()
  @Raw()
  @IsInt()
  @Min(1)
  @Max(100)
  portions?: number;

  @ApiProperty({ minimum: 0, description: 'Preparation time, in minutes.', example: 20 })
  @Raw()
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
  @Raw()
  @IsInt()
  @Min(0)
  @Max(1440)
  cookMinutes?: number | null;

  @ApiPropertyOptional({ enum: DIFFICULTIES, example: 'easy' })
  @IsOptional()
  @Raw()
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
  @Raw()
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
  @Raw()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString(FREE_TEXT)
  @Length(1, 40, FREE_TEXT)
  customDiets?: string[];

  @ApiPropertyOptional({
    enum: ALLERGEN_CODES,
    isArray: true,
    maxItems: 14,
    description:
      'Regulated allergens the chef adds on top of the computed ones (the recipe ' +
      'lines bring the rest; read them in `allergens`). Labels in ' +
      '`GET /referentials/allergens`.',
    example: ['celery'],
  })
  @IsOptional()
  @Raw()
  @IsArray()
  @ArrayMaxSize(14)
  @ArrayUnique()
  @IsIn(ALLERGEN_CODES, FREE_TEXT)
  addedAllergens?: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Other allergens, as free text. They never replace the answer about the 14 ' +
      'regulated ones.',
    example: ['sarrasin'],
  })
  @IsOptional()
  @Raw()
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
  @Raw()
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
  @Raw()
  @IsArray()
  @IsIn(DECLARED_DIET_CODES, FREE_TEXT)
  declaredDiets?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Codes from `GET /referentials/recipe-profiles`.',
    example: ['budget'],
  })
  @IsOptional()
  @Raw()
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
  @Raw()
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
  @Raw()
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

/** `POST /me/dishes/{id}/allergens/confirm`: an optional body (ruling R8). */
export class ConfirmAllergensDto {
  @ApiPropertyOptional({
    minimum: 0,
    description:
      'The `lockVersion` of the dish whose allergens the batch cooker read. If the ' +
      'dish changed since, the confirmation is refused, so allergens nobody saw are ' +
      'never confirmed.',
    example: 4,
  })
  @IsOptional()
  @Raw()
  @IsInt()
  @Min(0)
  lockVersion?: number;
}

export class UpdateDishDto extends PartialType(CreateDishDto) {
  @ApiPropertyOptional({
    minimum: 0,
    description:
      'The `lockVersion` of the dish as you read it. A save over a newer one is ' +
      'refused, so two screens never overwrite each other.',
    example: 4,
  })
  @IsOptional()
  @Raw()
  @IsInt()
  @Min(0)
  lockVersion?: number;
}

/** Recettes §8.2: the body of `POST /me/dishes/{id}/versions/{version}/restore`. */
export class RestoreVersionDto {
  @ApiPropertyOptional({
    minimum: 0,
    description:
      'The `lockVersion` of the dish as you read it. A restore over a newer one is refused.',
    example: 4,
  })
  @IsOptional()
  @Raw()
  @IsInt()
  @Min(0)
  lockVersion?: number;
}
