import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { QueryBoolean } from '../../../common/dto/query-boolean';
import { DIET_CODES } from '../domain/dishes.rules';

/** `?diets=vegetarian,gluten-free` → `['vegetarian', 'gluten-free']`. */
const commaList = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : value;

export class WeekMenusQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Any day of the wanted week, `YYYY-MM-DD`. Default: this week.',
    example: '2026-09-21',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  week?: string;

  @ApiPropertyOptional({
    description: 'INSEE region code, from `GET /referentials/regions`.',
    example: '93',
  })
  @IsOptional()
  @IsString()
  @Length(1, 3)
  region?: string;

  @ApiPropertyOptional({
    description:
      'INSEE code of a town. Send the `region` with it, so batch cookers who cover ' +
      'the whole region are found too.',
    example: '06088',
  })
  @IsOptional()
  @IsString()
  @Length(1, 10)
  city?: string;

  @ApiPropertyOptional({
    description:
      'Diets the **whole** menu must satisfy, comma-separated, from ' +
      '`GET /referentials/diets`.',
    example: 'vegetarian,gluten-free',
    type: String,
  })
  @IsOptional()
  @Transform(commaList)
  @IsArray()
  @ArrayMaxSize(6)
  @IsIn(DIET_CODES, { each: true })
  diets?: string[];

  @ApiPropertyOptional({
    description: '`true`: only batch cookers who do the shopping for that menu.',
    example: true,
  })
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  shoppingIncluded?: boolean;

  @ApiPropertyOptional({
    maxLength: 100,
    description:
      'Free text, looked up in the cook’s name, town, menu title and dish names.',
    example: 'pho',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class ChefShowcaseQueryDto {
  @ApiPropertyOptional({
    description: 'First day, `YYYY-MM-DD`. Default: this week.',
    example: '2026-09-01',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({
    description: 'Last day, `YYYY-MM-DD`. Default: eight weeks later; 26 weeks at most.',
    example: '2026-10-31',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  to?: string;
}
