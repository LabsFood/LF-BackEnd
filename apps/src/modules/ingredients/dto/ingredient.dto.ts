import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { COMPUTED_DIET_CODES } from '../../dishes/domain/dishes.rules';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** One entry of the common ingredient list (Recettes §4.10). */
export class CatalogIngredientDto {
  @ApiProperty({ maxLength: 120, example: 'Tomate' })
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Other names a chef may type. Stored in lowercase.',
    example: ['pomme d’amour'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @Length(1, 120, { each: true })
  aliases?: string[];

  @ApiPropertyOptional({
    enum: COMPUTED_DIET_CODES,
    isArray: true,
    description:
      'The diets the ingredient suits. Labels in `GET /referentials/computed-diets`.',
    example: ['vegetarian', 'vegan', 'no-pork', 'gluten-free', 'lactose-free'],
  })
  @IsOptional()
  @IsArray()
  @IsIn(COMPUTED_DIET_CODES, { each: true })
  diets?: string[];

  @ApiPropertyOptional({
    type: [Number],
    description: 'Months in season, 1 to 12. Empty: not seasonal.',
    example: [6, 7, 8, 9],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(12, { each: true })
  seasonMonths?: number[];
}

export class UpdateCatalogIngredientDto extends PartialType(CatalogIngredientDto) {}

export class ListCatalogIngredientsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ maxLength: 60, description: 'Part of a name, or another name.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  search?: string;
}

export class SearchIngredientsQueryDto {
  @ApiProperty({ maxLength: 60, example: 'tom' })
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  search!: string;
}

/** BLK-33: the entry of the common list a batch cooker copies into their own list. */
export class AdoptIngredientDto {
  @ApiProperty({ format: 'uuid', example: '0d7c1c7a-3f5b-4d8e-9a1c-2b4e6f8a0c11' })
  @IsUUID()
  catalogIngredientId!: string;
}

/** Re-exported so the controller's swagger can name the page type. */
export { Type };
