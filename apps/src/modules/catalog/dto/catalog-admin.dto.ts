import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

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
    default: 'draft',
    description: 'Publication status. Use `draft` until ready for menu weeks.',
    example: 'draft',
  })
  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateMealDto extends PartialType(CreateMealDto) {}

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
