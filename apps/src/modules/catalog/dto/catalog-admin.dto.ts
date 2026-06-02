import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateMealDto {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  prepTime!: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dietaryTags?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allergens?: string[];

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  ingredients?: object;

  @ApiPropertyOptional({ default: 'draft' })
  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateMealDto extends PartialType(CreateMealDto) {}

export class CreateMenuWeekDto {
  @ApiProperty()
  @IsInt()
  year!: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  weekNumber!: number;

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  mealIds?: string[];
}

export class UpdateFormuleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  priceTtc?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  priceAfterTax?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  features?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
