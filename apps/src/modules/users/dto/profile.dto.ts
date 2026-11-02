import { ApiPropertyOptional, IntersectionType, PartialType } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

import { CLIENT_STATUS_HELP, CLIENT_STATUSES } from './admin-client.dto';

/**
 * Fields that live on `client_profiles`. Every property here must map to a real
 * column: both `PATCH /me/profile` and `PATCH /admin/clients/:id` spread this
 * payload straight into Prisma, so a stray user-level field would throw at runtime.
 * User-level fields belong on {@link UpdateMeProfileDto} instead.
 */
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

  @ApiPropertyOptional({
    maxLength: 255,
    description: 'Street address where the batch cooking session takes place.',
    example: '12 rue de la Paix',
  })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  addressStreet?: string;

  @ApiPropertyOptional({
    maxLength: 120,
    description: 'City for the service address.',
    example: 'Paris',
  })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  addressCity?: string;

  @ApiPropertyOptional({
    maxLength: 16,
    description: 'Postal code for the service address.',
    example: '75002',
  })
  @IsOptional()
  @IsString()
  @Length(1, 16)
  addressPostalCode?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 20,
    description: 'Number of adults in the household, used to size portions.',
    example: 2,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  householdAdults?: number;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 20,
    description: 'Number of children in the household, used to size portions.',
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  householdKids?: number;
}

/**
 * User-level identity fields shared by the client and chef onboarding forms.
 * These write to `users`, not to a profile table.
 */
export class UpdateOwnUserFieldsDto {
  @ApiPropertyOptional({
    maxLength: 128,
    description:
      'First name. Combined with `lastName` into `users.full_name` and synced to Clerk.',
    example: 'Marie',
  })
  @IsOptional()
  @IsString()
  @Length(1, 128)
  firstName?: string;

  @ApiPropertyOptional({
    maxLength: 128,
    description:
      'Last name. Combined with `firstName` into `users.full_name` and synced to Clerk.',
    example: 'Dupont',
  })
  @IsOptional()
  @IsString()
  @Length(1, 128)
  lastName?: string;

  @ApiPropertyOptional({
    maxLength: 32,
    description: 'Contact phone number stored on `users.phone`.',
    example: '+33612345678',
  })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  phone?: string;
}

/**
 * Body for `PATCH /me/profile` (client onboarding, form 2).
 * Carries both `client_profiles` columns and user-level identity fields;
 * the service splits them before touching Prisma.
 */
export class UpdateMeProfileDto extends IntersectionType(
  PartialType(UpsertClientProfileDto),
  UpdateOwnUserFieldsDto,
) {}

/** Partial update body for `PATCH /me/profile`. @deprecated use {@link UpdateMeProfileDto} */
export class UpdateClientProfileDto extends PartialType(UpsertClientProfileDto) {}

/** Partial update body for `PATCH /admin/clients/:id` (includes CRM status). */
export class UpdateAdminClientDto extends PartialType(UpsertClientProfileDto) {
  @ApiPropertyOptional({
    enum: CLIENT_STATUSES,
    description: CLIENT_STATUS_HELP,
    example: 'vip',
  })
  @IsOptional()
  @IsIn(CLIENT_STATUSES)
  status?: (typeof CLIENT_STATUSES)[number];
}
