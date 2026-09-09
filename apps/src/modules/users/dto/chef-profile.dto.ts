import { ApiProperty, ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

import { UpdateOwnUserFieldsDto } from './profile.dto';

/**
 * Fields a chef may set on their own `chef_profiles` row.
 *
 * `isActive`, `isVerified`, `stripeAccountId`, and `cronofyProfileId` are absent by
 * design: self-registered chefs must not be able to mark themselves live or attach a
 * payout account. Vetting happens through `PATCH /admin/chefs/:id/verification`.
 */
export class UpsertChefProfileDto {
  @ApiProperty({
    maxLength: 255,
    description: 'Public display name shown to clients.',
    example: 'Chef Marie D.',
  })
  @IsString()
  @Length(1, 255)
  displayName!: string;

  @ApiPropertyOptional({
    description: 'Short public biography.',
    example: 'Fifteen years of Mediterranean batch cooking.',
  })
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional({
    maxLength: 120,
    description: 'City the chef operates from.',
    example: 'Paris',
  })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  city?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 200,
    default: 10,
    description: 'Distance in kilometres the chef will travel for a session.',
    example: 25,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  serviceRadiusKm?: number;
}

/**
 * Body for `PATCH /me/chef-profile` (chef onboarding, form 2).
 * Combines `chef_profiles` columns with the shared user-level identity fields.
 */
export class UpdateMeChefProfileDto extends IntersectionType(
  UpsertChefProfileDto,
  UpdateOwnUserFieldsDto,
) {}
