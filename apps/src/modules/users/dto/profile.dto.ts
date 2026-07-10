import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsArray, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpsertClientProfileDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Dietary preferences (e.g. `vegetarian`, `halal`, `gluten-free`).',
    example: ['vegetarian'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dietaryPreferences?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Food allergies the chef must avoid.',
    example: ['peanuts', 'shellfish'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allergies?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Ingredients, textures, or dishes the client dislikes.',
    example: ['cilantro'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dislikes?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Preferred dishes, cuisines, or ingredients.',
    example: ['pasta', 'mediterranean'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  favorites?: string[];

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 10,
    description: 'Preferred spice level: 0 = mild, 10 = very hot.',
    example: 4,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  spiceLevel?: number;

  @ApiPropertyOptional({
    description: 'Free-text notes about the client kitchen, equipment, or habits.',
    example: 'Induction hob only, no oven.',
  })
  @IsOptional()
  @IsString()
  kitchenNotes?: string;
}

/** Partial update body for `PATCH /me/profile`. */
export class UpdateClientProfileDto extends PartialType(UpsertClientProfileDto) {}

/** Partial update body for `PATCH /admin/clients/:id` (includes CRM status). */
export class UpdateAdminClientDto extends PartialType(UpsertClientProfileDto) {
  @ApiPropertyOptional({
    enum: ['vip', 'active', 'prospect', 'inactive'],
    description: 'CRM lifecycle status for admin client management.',
    example: 'active',
  })
  @IsOptional()
  @IsString()
  status?: string;
}
