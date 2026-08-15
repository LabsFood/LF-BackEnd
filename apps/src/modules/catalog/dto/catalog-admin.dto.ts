import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

import {
  MealContinent,
  MealDifficulty,
  MealStatus,
} from '../../../generated/prisma/client';

export class CreateMealDto {
  @ApiProperty({
    description: 'Display name of the dish.',
    example: 'Poulet yassa',
  })
  @IsString()
  name!: string;

  @ApiPropertyOptional({
    description: 'Marketing or menu description shown to clients.',
  })
  @IsOptional()
  @IsString()
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
    type: [String],
    description: 'Dietary tags (e.g. `vegetarian`, `gluten-free`).',
    example: ['halal'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dietaryTags?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Declared allergens for the dish.',
    example: ['dairy'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allergens?: string[];

  @ApiPropertyOptional({
    type: Object,
    description: 'Structured ingredient list (quantities and units).',
  })
  @IsOptional()
  @IsObject()
  ingredients?: object;

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
    enum: MealContinent,
    description: 'Culinary region the dish originates from.',
    example: MealContinent.africa,
  })
  @IsOptional()
  @IsEnum(MealContinent)
  continent?: MealContinent | null;

  @ApiPropertyOptional({
    maxLength: 120,
    description: 'Country of origin of the dish.',
    example: 'Sénégal',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
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
    enum: MealDifficulty,
    description: 'How hard the recipe is to cook.',
    example: MealDifficulty.medium,
  })
  @IsOptional()
  @IsEnum(MealDifficulty)
  difficulty?: MealDifficulty | null;

  @ApiPropertyOptional({
    type: [String],
    description: 'Ordered preparation steps.',
    example: ['Marinate the chicken', 'Sear the onions'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  steps?: string[];

  @ApiPropertyOptional({
    default: false,
    description: 'Highlight this dish on the client-facing menu.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @ApiPropertyOptional({
    enum: MealStatus,
    default: MealStatus.draft,
    description: 'Publication status. Use `draft` until ready for menu weeks.',
    example: MealStatus.draft,
  })
  @IsOptional()
  @IsEnum(MealStatus)
  status?: MealStatus;
}

export class UpdateMealDto extends PartialType(CreateMealDto) {}

/**
 * Shape of a meal record as returned by the admin endpoints. Documentation only:
 * handlers return the Prisma record directly, there is no serialization layer.
 */
export class MealResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Poulet yassa' })
  name!: string;

  @ApiProperty({ type: String, nullable: true })
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

  @ApiProperty({ enum: MealContinent, nullable: true })
  continent!: MealContinent | null;

  @ApiProperty({ type: String, nullable: true, example: 'Sénégal' })
  country!: string | null;

  @ApiProperty({ example: 4 })
  portions!: number;

  @ApiProperty({ example: 45, description: 'Preparation time in minutes.' })
  prepTime!: number;

  @ApiProperty({ type: [String], example: ['halal'] })
  dietaryTags!: string[];

  @ApiProperty({ type: [String], example: ['dairy'] })
  allergens!: string[];

  @ApiProperty({ type: Number, nullable: true, example: 620 })
  calories!: number | null;

  @ApiProperty({ enum: MealDifficulty, nullable: true })
  difficulty!: MealDifficulty | null;

  @ApiProperty({
    type: Object,
    description: 'Structured ingredient list (quantities and units).',
  })
  ingredients!: unknown;

  @ApiProperty({ type: [String] })
  steps!: string[];

  @ApiProperty({ example: false })
  isFeatured!: boolean;

  @ApiProperty({ enum: MealStatus })
  status!: MealStatus;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
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
    description: 'Meal uuids to include in this weekly menu.',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  mealIds?: string[];
}

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
    description: 'Net price after tax, in minor currency units (cents).',
    example: 8250,
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
