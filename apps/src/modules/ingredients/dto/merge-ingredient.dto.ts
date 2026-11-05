import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** Recettes §7.2: the common ingredient a chef's one is merged into. */
export class MergeIngredientDto {
  @ApiProperty({
    format: 'uuid',
    description: 'The common, active ingredient to merge into.',
    example: '0d7c1c7a-3f5b-4d8e-9a1c-2b4e6f8a0c11',
  })
  @IsUUID()
  intoId!: string;
}
