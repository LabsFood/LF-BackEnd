import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateBy,
} from 'class-validator';

import { oneLine } from '../../../common/dto/clean-text';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { OptionalNotNull, Raw } from '../../../common/dto/strict';
import { QueryBoolean } from '../../../common/dto/query-boolean';
import { ALLERGEN_CODES, COMPUTED_DIET_CODES } from '../../dishes/domain/dishes.rules';
import { keyFits, NAME_MAX } from '../domain/ingredient.rules';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const eachOneLine = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? value.map((v: unknown) => oneLine({ value: v })) : value;

/**
 * M4: the stored key (`normalized_name`, 120 characters) spells œ and æ out, so a
 * name of 120 characters can overflow it: 400 here, never a 500 from Postgres.
 */
const KeyFits = () =>
  ValidateBy({
    name: 'keyFits',
    validator: {
      validate: (value: unknown) => typeof value !== 'string' || keyFits(value),
      defaultMessage: () =>
        `name must be at most ${NAME_MAX} characters, œ and æ counting as two`,
    },
  });

/** Recettes §4.10: the four states of an entry of the common list. */
export const CATALOG_STATUSES = ['active', 'inactive', 'pending', 'merged'] as const;

/** One entry of the common ingredient list (Recettes §4.10 / §5.1). */
export class CatalogIngredientDto {
  @ApiProperty({ maxLength: 120, example: 'Tomate' })
  @Raw()
  @Transform(oneLine)
  @IsString()
  @Length(1, 120)
  @KeyFits()
  name!: string;

  @ApiPropertyOptional({
    type: [String],
    maxItems: 20,
    description: 'Other names a chef may type, 20 at most. Stored in lowercase.',
    example: ['pomme d’amour'],
  })
  @OptionalNotNull()
  @Raw()
  @IsArray()
  @ArrayMaxSize(20)
  @Transform(eachOneLine)
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
  @OptionalNotNull()
  @Raw()
  @IsArray()
  @IsIn(COMPUTED_DIET_CODES, { each: true })
  diets?: string[];

  @ApiPropertyOptional({
    type: [Number],
    description: 'Months in season, 1 to 12, each once. Empty: not seasonal.',
    example: [6, 7, 8, 9],
  })
  @OptionalNotNull()
  @Raw()
  @IsArray()
  @ArrayMaxSize(12)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(12, { each: true })
  seasonMonths?: number[];

  @ApiPropertyOptional({
    maxLength: 60,
    description:
      'The supermarket aisle: a code of the list in force. `422` when it is not in it.',
    example: 'fruits-legumes',
  })
  @OptionalNotNull()
  @Raw()
  @IsString()
  @Length(1, 60)
  aisle?: string;

  @ApiPropertyOptional({
    enum: ALLERGEN_CODES,
    isArray: true,
    description:
      'The allergens it contains, each once. Not together with `allergensNone`.',
    example: ['gluten'],
  })
  @OptionalNotNull()
  @Raw()
  @IsArray()
  @ArrayUnique()
  @IsIn(ALLERGEN_CODES, { each: true })
  allergens?: string[];

  @ApiPropertyOptional({
    description:
      'True: it holds none of the 14 allergens. Not together with `allergens`.',
    example: true,
  })
  @OptionalNotNull()
  @Raw()
  @IsBoolean()
  allergensNone?: boolean;

  @ApiPropertyOptional({
    description: 'A basic (salt, oil…): a pantry staple, left out of shopping lists.',
    example: false,
  })
  @OptionalNotNull()
  @Raw()
  @IsBoolean()
  isBasic?: boolean;
}

// I4: every field may be left out, none sent as null (400, never a 500).
export class UpdateCatalogIngredientDto extends PartialType(CatalogIngredientDto, {
  skipNullProperties: false,
}) {
  @ApiPropertyOptional({
    enum: ['active', 'inactive'],
    description: 'Only for a common entry: a chef’s private entry answers `422`.',
  })
  @OptionalNotNull()
  @Raw()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';
}

export class ListCatalogIngredientsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ maxLength: 60, description: 'Part of a name, or another name.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  search?: string;

  @ApiPropertyOptional({ enum: CATALOG_STATUSES })
  @IsOptional()
  @IsIn(CATALOG_STATUSES)
  status?: (typeof CATALOG_STATUSES)[number];

  @ApiPropertyOptional({ maxLength: 60, description: 'An aisle code.' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  aisle?: string;

  @ApiPropertyOptional({
    description: 'True: no aisle, or allergens neither listed nor declared "none".',
  })
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  incomplete?: boolean;

  @ApiPropertyOptional({
    description:
      'Ruling R28. True: a change of the entry is still to carry into the recipes ' +
      '(a run cut short, or dishes that failed): replay it with ' +
      '`POST /admin/ingredients/:id/propagate`. False: nothing pending.',
  })
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  carryPending?: boolean;

  @ApiPropertyOptional({ description: 'True: reviewed by an admin; false: not yet.' })
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  reviewed?: boolean;
}

export class SearchIngredientsQueryDto {
  @ApiProperty({ maxLength: 60, example: 'tom' })
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  search!: string;
}

/** Re-exported so the controller's swagger can name the page type. */
export { Type };
