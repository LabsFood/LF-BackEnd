import {
  ApiProperty,
  ApiPropertyOptional,
  IntersectionType,
  PartialType,
} from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

import { UpdateOwnUserFieldsDto } from './profile.dto';

/**
 * Languages a batch cooker can say they speak, ISO 639-1. A closed list so the
 * public page can label and filter them; one missing is a line added here.
 */
export const LANGUAGES = [
  { code: 'fr', label: 'Français' },
  { code: 'en', label: 'Anglais' },
  { code: 'es', label: 'Espagnol' },
  { code: 'it', label: 'Italien' },
  { code: 'de', label: 'Allemand' },
  { code: 'pt', label: 'Portugais' },
  { code: 'nl', label: 'Néerlandais' },
  { code: 'ar', label: 'Arabe' },
  { code: 'zh', label: 'Chinois' },
  { code: 'ru', label: 'Russe' },
  { code: 'pl', label: 'Polonais' },
  { code: 'ro', label: 'Roumain' },
  { code: 'tr', label: 'Turc' },
  { code: 'el', label: 'Grec' },
  { code: 'uk', label: 'Ukrainien' },
  { code: 'vi', label: 'Vietnamien' },
  { code: 'ja', label: 'Japonais' },
  { code: 'hi', label: 'Hindi' },
  { code: 'fa', label: 'Persan' },
  { code: 'wo', label: 'Wolof' },
  { code: 'ln', label: 'Lingala' },
  { code: 'bm', label: 'Bambara' },
  { code: 'ff', label: 'Peul' },
  { code: 'sw', label: 'Swahili' },
] as const;

const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);

/**
 * Public fields a batch cooker may edit on their own `chef_profiles` row.
 *
 * Deliberately absent: `isActive` and `isVerified` (set at candidature approval
 * and by the dossier), `stripeAccountId` and `cronofyProfileId` (payout and
 * calendar wiring), and the SAP route and intervention zones, which were verified
 * against documents during the candidature. `avatarUrl` is on the account and set
 * only by the photo upload (`/me/avatar`), which checks the file. The global `ValidationPipe` runs with
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

  @ApiPropertyOptional({
    enum: LANGUAGE_CODES,
    isArray: true,
    description:
      'Languages spoken with clients, codes from `GET /referentials/languages`. ' +
      'Replaces the whole list; `[]` clears it.',
    example: ['fr', 'en'],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(LANGUAGE_CODES, { each: true })
  languages?: string[];
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
