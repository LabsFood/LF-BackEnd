import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { ALLERGEN_CODES } from '../../dishes/domain/dishes.rules';

/** Body of `PUT /me/profile/allergies`: a list with consent, or "none". */
export class DeclareAllergiesDto {
  @ApiPropertyOptional({
    description: '"No allergy". Alone: no list, no consent needed.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  none?: boolean;

  @ApiPropertyOptional({
    type: [String],
    enum: ALLERGEN_CODES,
    description: 'The 14 regulated allergens, by code (`GET /reference/allergens`).',
    example: ['peanuts', 'milk'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(14)
  @IsIn(ALLERGEN_CODES, { each: true })
  allergies?: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'What the 14 do not cover, in the client’s words. The batch cooker reads it; the ' +
      'platform checks only a word that names one of the 14.',
    example: ['kiwi'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  customAllergies?: string[];

  @ApiPropertyOptional({
    description: 'The client accepts the consent text. Needed with a list.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  consent?: boolean;

  @ApiPropertyOptional({
    description: 'The `healthConsent.version` of `GET /me/profile` the client read.',
    example: '2026-11-10',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  consentVersion?: string;
}
