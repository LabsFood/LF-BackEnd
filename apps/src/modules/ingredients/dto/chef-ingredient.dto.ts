import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

import { CatalogIngredientDto } from './ingredient.dto';

/**
 * Recettes §7.1: an ingredient a chef adds when the common list lacks one. The
 * fields of a common entry, the aisle now required. The allergens (or "none") are
 * required too, checked by the service (400): "not filled in" is no answer for an
 * allergen. Status, owner and review are never the chef's to send.
 */
export class ChefIngredientDto extends OmitType(CatalogIngredientDto, [
  'aisle',
] as const) {
  @ApiProperty({
    maxLength: 60,
    description:
      'The supermarket aisle: a code of the list in force. `422` when it is not in it.',
    example: 'epicerie',
  })
  @IsString()
  @Length(1, 60)
  aisle!: string;
}

/** Any part of an own pending ingredient (Recettes §7.1). */
export class UpdateChefIngredientDto extends PartialType(ChefIngredientDto) {}
