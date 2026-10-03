import {
  ApiProperty,
  ApiPropertyOptional,
  IntersectionType,
  PartialType,
} from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

import { UpdateOwnUserFieldsDto } from './profile.dto';

/**
 * Public fields a batch cooker may edit on their own `chef_profiles` row.
 *
 * Deliberately absent: `isActive` and `isVerified` (set at candidature approval
 * and by the dossier), `stripeAccountId` and `cronofyProfileId` (payout and
 * calendar wiring), and the SAP route and intervention zones, which were verified
 * against documents during the candidature. `avatarUrl` is set only by the photo
 * upload, which checks the file. The global `ValidationPipe` runs with
 * `forbidNonWhitelisted`, so a body carrying any of them is refused rather than
 * silently stripped.
 */
export class ChefProfileFieldsDto {
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
 * Body for `PATCH /me/chef-profile` — a batch cooker editing their own profile.
 *
 * Every field is optional: this only ever updates an existing profile, so there
 * is nothing to require. A field that is sent is still validated, which is what
 * stops `displayName` from being blanked.
 */
export class UpdateMeChefProfileDto extends PartialType(
  IntersectionType(ChefProfileFieldsDto, UpdateOwnUserFieldsDto),
) {}
