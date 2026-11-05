import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO31661Alpha2,
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

import {
  MealContinent,
  MealDifficulty,
  MealStatus,
} from '../../../generated/prisma/client';
import {
  ALLERGEN_CODES,
  DIET_CODES,
  DISH_CATEGORY_CODES,
} from '../../dishes/domain/dishes.rules';
import {
  IngredientDto,
  ReheatingDto,
  StepDto,
  StorageDto,
} from '../../dishes/dto/dish.dto';

/** Choices in a sensible order: alphabetical for places, lifecycle for statuses. */
const CONTINENTS = ['africa', 'americas', 'asia', 'europe', 'middle_east'];
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const MEAL_STATUSES = ['draft', 'published', 'archived'];
const MEAL_STATUS_HELP =
  '`draft`: being written, not offered. `published`: can go on a weekly menu. ' +
  '`archived`: no longer offered, kept because past bookings use it.';

export class CreateMealDto {
  @ApiProperty({
    maxLength: 255,
    description: 'Display name of the dish.',
    example: 'Poulet yassa',
  })
  @IsString()
  @Length(1, 255)
  name!: string;

  @ApiPropertyOptional({
    maxLength: 2000,
    description: 'Marketing or menu description shown to clients.',
    example: 'Poulet mariné au citron et aux oignons, riz blanc.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({
    minimum: 1,
    description: 'Preparation time in minutes.',
    example: 45,
  })
  @IsInt()
  @Min(1)
  prepTime!: number;

  @ApiPropertyOptional({
    enum: DIET_CODES,
    isArray: true,
    description: 'Diets, from `GET /referentials/diets`.',
    example: ['halal'],
  })
  @IsOptional()
  @IsArray()
  @IsIn(DIET_CODES, { each: true })
  dietaryTags?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Diets outside the list, as free text.',
    example: [],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @Length(1, 40, { each: true })
  customDiets?: string[];

  @ApiPropertyOptional({
    enum: ALLERGEN_CODES,
    isArray: true,
    maxItems: 14,
    description:
      'Regulated allergens added on top of the computed ones (Recettes §6.1): the ' +
      'recipe lines bring the rest, read them in `allergens`. Labels in ' +
      '`GET /referentials/allergens`. The meal no longer takes `allergens` or ' +
      '`allergensNone`: they are computed.',
    example: ['celery'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(14)
  @ArrayUnique()
  @IsIn(ALLERGEN_CODES, { each: true })
  addedAllergens?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Other allergens, as free text.',
    example: [],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @Length(1, 40, { each: true })
  customAllergens?: string[];

  @ApiPropertyOptional({
    type: [IngredientDto],
    description:
      'The ingredients for `portions` portions, one line each. Shopping lists are ' +
      'computed from this list.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => IngredientDto)
  ingredients?: IngredientDto[];

  @ApiPropertyOptional({
    enum: DISH_CATEGORY_CODES,
    description:
      'Where the meal sits in a meal, from `GET /referentials/dish-categories`.',
    example: 'main',
  })
  @IsOptional()
  @IsIn(DISH_CATEGORY_CODES)
  category?: string | null;

  @ApiPropertyOptional({
    minimum: 0,
    description: 'Cooking time in minutes.',
    example: 30,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  cookTime?: number | null;

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

  @ApiPropertyOptional({
    type: String,
    maxLength: 512,
    description:
      'URL of the meal image (hosted in Supabase storage). Upload the file first, then ' +
      'send the resulting public URL here. Send `null` on update to remove the image.',
    example:
      'https://your-project-ref.supabase.co/storage/v1/object/public/meal-images/poulet-yassa.jpg',
  })
  @IsOptional()
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
  })
  @MaxLength(512)
  imageUrl?: string | null;

  @ApiPropertyOptional({
    enum: CONTINENTS,
    description: 'Culinary region the dish comes from.',
    example: MealContinent.africa,
  })
  @IsOptional()
  @IsEnum(MealContinent)
  continent?: MealContinent | null;

  @ApiPropertyOptional({
    description:
      "Country of origin, ISO 3166 alpha-2. It colours the client's culinary map, " +
      'and a batch cooker cannot publish an adopted meal without it.',
    example: 'SN',
  })
  @IsOptional()
  @IsISO31661Alpha2()
  country?: string | null;

  @ApiPropertyOptional({
    minimum: 1,
    default: 4,
    description: 'Number of portions the recipe yields.',
    example: 4,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  portions?: number;

  @ApiPropertyOptional({
    minimum: 0,
    description: 'Energy per portion, in kilocalories.',
    example: 620,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  calories?: number | null;

  @ApiPropertyOptional({
    enum: DIFFICULTIES,
    description: 'How hard the recipe is to cook.',
    example: MealDifficulty.medium,
  })
  @IsOptional()
  @IsEnum(MealDifficulty)
  difficulty?: MealDifficulty | null;

  @ApiPropertyOptional({
    type: [StepDto],
    description: 'The steps, in order: at most 40, of 2,000 characters each.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => StepDto)
  steps?: StepDto[];

  @ApiPropertyOptional({
    enum: ['halal', 'kosher'],
    isArray: true,
    description: 'Recettes §4.8: the diets declared, not computable (halal, kosher).',
  })
  @IsOptional()
  @IsArray()
  @IsIn(['halal', 'kosher'], { each: true })
  declaredDiets?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Codes from `GET /referentials/recipe-profiles`.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @Length(1, 40, { each: true })
  profiles?: string[];

  @ApiPropertyOptional({
    type: [Number],
    description: 'Months in season set instead of the computed ones; `[]` for none.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(12, { each: true })
  seasonsOverride?: number[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Equipment the recipe needs, as free text. Optional, never checked.',
    example: ['Cocotte en fonte'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 60, { each: true })
  equipment?: string[];

  @ApiPropertyOptional({
    default: false,
    description: 'Highlight this dish on the client-facing menu.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @ApiPropertyOptional({
    enum: MEAL_STATUSES,
    default: MealStatus.draft,
    description: MEAL_STATUS_HELP,
    example: MealStatus.draft,
  })
  @IsOptional()
  // Not `suspended`: that one is for moderating a batch cooker's dish.
  @IsIn(MEAL_STATUSES)
  status?: MealStatus;
}

export class UpdateMealDto extends PartialType(CreateMealDto) {}

/**
 * Shape of a meal record as returned by the admin endpoints. Documentation only:
 * handlers return the Prisma record directly, there is no serialization layer.
 */
export class MealResponseDto {
  @ApiProperty({ format: 'uuid', example: 'd3eebc99-9c0b-4ef8-bb6d-6bb9bd380a44' })
  id!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      "The owner. `null` for a Lab's Food meal, which is the only kind these admin " +
      'routes return.',
    example: null,
  })
  chefProfileId!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'The user who wrote it, for attribution only: it gives no right to edit. ' +
      '`null` for meals written before authorship was recorded.',
    example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  })
  createdByUserId!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'The batch cooker this meal is prepared for, as an offer (`POST ' +
      '/admin/meals/{id}/offer`); only they see it until they accept. `null` otherwise.',
    example: null,
  })
  offeredToChefProfileId!: string | null;

  @ApiProperty({ example: 'Poulet yassa' })
  name!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Poulet mariné au citron et aux oignons, riz blanc.',
  })
  description!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    maxLength: 512,
    description: 'Public URL of the dish photo, or `null` when none is set.',
    example:
      'https://your-project-ref.supabase.co/storage/v1/object/public/meal-images/poulet-yassa.jpg',
  })
  imageUrl!: string | null;

  @ApiProperty({
    enum: CONTINENTS,
    nullable: true,
    description: 'Culinary region the dish comes from.',
    example: 'africa',
  })
  continent!: MealContinent | null;

  @ApiProperty({ type: String, nullable: true, example: 'SN' })
  country!: string | null;

  @ApiProperty({ example: 4 })
  portions!: number;

  @ApiProperty({ example: 45, description: 'Preparation time in minutes.' })
  prepTime!: number;

  @ApiProperty({ type: [String], example: ['halal'] })
  dietaryTags!: string[];

  @ApiProperty({
    type: [String],
    description:
      'Computed from the recipe lines plus `addedAllergens` (Recettes §6.1); never written directly.',
    example: ['milk'],
  })
  allergens!: string[];

  @ApiProperty({
    type: [String],
    description: 'Allergens only optional lines bring; still listed in `allergens`.',
    example: [],
  })
  conditionalAllergens!: string[];

  @ApiProperty({ type: [String], description: 'Allergens added by hand.', example: [] })
  addedAllergens!: string[];

  @ApiProperty({
    example: false,
    description: 'Computed: true only when every line is known and brings nothing.',
  })
  allergensNone!: boolean;

  @ApiProperty({ type: [String], example: [] })
  customDiets!: string[];

  @ApiProperty({ type: [String], example: [] })
  customAllergens!: string[];

  @ApiProperty({ type: String, nullable: true, example: 'main' })
  category!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 30 })
  cookTime!: number | null;

  @ApiProperty({
    type: ReheatingDto,
    nullable: true,
    example: { mode: 'oven', temperature: 160, minutes: 15, note: null },
  })
  reheating!: unknown;

  @ApiProperty({
    type: StorageDto,
    nullable: true,
    example: { method: 'fridge', days: 3, container: null },
  })
  storage!: unknown;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Last time it was published.',
    example: null,
  })
  publishedAt!: Date | null;

  @ApiProperty({ type: Number, nullable: true, example: 620 })
  calories!: number | null;

  @ApiProperty({
    enum: DIFFICULTIES,
    nullable: true,
    description: 'How hard the recipe is to cook.',
    example: 'medium',
  })
  difficulty!: MealDifficulty | null;

  @ApiProperty({
    type: Object,
    description:
      'The ingredients, as stored: a list of `{ name, qty, unit, aisle }`. Meals ' +
      'written before this was checked may hold something else, which shopping lists ' +
      'ignore.',
    example: [{ name: 'Cuisses de poulet', qty: 8, unit: 'piece', aisle: 'boucherie' }],
  })
  ingredients!: unknown;

  @ApiProperty({
    type: [StepDto],
    description:
      '`{ order, text, type, durationMinutes }`, in order. Steps written before ' +
      'Recettes lot 2 are plain text.',
    example: [
      { order: 1, text: 'Mariner le poulet', type: 'preparation', durationMinutes: 60 },
    ],
  })
  steps!: unknown;

  @ApiProperty({ example: false })
  isFeatured!: boolean;

  @ApiProperty({
    description:
      'Recettes §4.11, computed: `{ ready, problems, toPublish, warnings }`, each ' +
      'problem `{ code, field, message }`.',
    example: { ready: false, problems: [], toPublish: [], warnings: [] },
  })
  readiness!: unknown;

  @ApiProperty({
    enum: MEAL_STATUSES,
    description: MEAL_STATUS_HELP,
    example: 'published',
  })
  status!: MealStatus;

  @ApiProperty({ format: 'date-time', example: '2026-09-01T08:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time', example: '2026-09-03T14:12:00.000Z' })
  updatedAt!: Date;
}

export class CreateMenuWeekDto {
  @ApiProperty({
    description: 'ISO calendar year for the menu week.',
    example: 2026,
  })
  @IsInt()
  year!: number;

  @ApiProperty({
    minimum: 1,
    description: 'ISO week number (1–53).',
    example: 28,
  })
  @IsInt()
  @Min(1)
  weekNumber!: number;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description: 'The meals on this menu, by id (from `GET /admin/meals`).',
    example: ['d3eebc99-9c0b-4ef8-bb6d-6bb9bd380a44'],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  mealIds?: string[];
}

/** Send only what changes; `mealIds` replaces the whole list, `[]` empties it. */
export class UpdateMenuWeekDto extends PartialType(CreateMenuWeekDto) {}

export class UpdateFormuleDto {
  @ApiPropertyOptional({
    description: 'Display name of the pricing package.',
    example: 'Formule Famille',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    minimum: 0,
    description: 'Price including tax, in minor currency units (cents).',
    example: 9900,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  priceTtc?: number;

  @ApiPropertyOptional({
    minimum: 0,
    description:
      'What the client really pays after the 50 % "services à la personne" tax ' +
      'credit, in cents.',
    example: 4950,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  priceAfterTax?: number;

  @ApiPropertyOptional({
    type: [String],
    description: 'Marketing bullet points for the package.',
    example: ['3 meals per week', 'Free delivery'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  features?: string[];

  @ApiPropertyOptional({
    description: 'Whether the formule is offered to new clients.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
