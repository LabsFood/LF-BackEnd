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
 * Languages a batch cooker can say they speak: every ISO 639-1 code, so a public
 * dropdown never lacks one. Labels are the French names from the runtime's ICU
 * (full ICU is the Node default); the spec fails if a code comes back unnamed.
 */
const ISO_639_1 = [
  'aa',
  'ab',
  'ae',
  'af',
  'ak',
  'am',
  'an',
  'ar',
  'as',
  'av',
  'ay',
  'az',
  'ba',
  'be',
  'bg',
  'bh',
  'bi',
  'bm',
  'bn',
  'bo',
  'br',
  'bs',
  'ca',
  'ce',
  'ch',
  'co',
  'cr',
  'cs',
  'cu',
  'cv',
  'cy',
  'da',
  'de',
  'dv',
  'dz',
  'ee',
  'el',
  'en',
  'eo',
  'es',
  'et',
  'eu',
  'fa',
  'ff',
  'fi',
  'fj',
  'fo',
  'fr',
  'fy',
  'ga',
  'gd',
  'gl',
  'gn',
  'gu',
  'gv',
  'ha',
  'he',
  'hi',
  'ho',
  'hr',
  'ht',
  'hu',
  'hy',
  'hz',
  'ia',
  'id',
  'ie',
  'ig',
  'ii',
  'ik',
  'io',
  'is',
  'it',
  'iu',
  'ja',
  'jv',
  'ka',
  'kg',
  'ki',
  'kj',
  'kk',
  'kl',
  'km',
  'kn',
  'ko',
  'kr',
  'ks',
  'ku',
  'kv',
  'kw',
  'ky',
  'la',
  'lb',
  'lg',
  'li',
  'ln',
  'lo',
  'lt',
  'lu',
  'lv',
  'mg',
  'mh',
  'mi',
  'mk',
  'ml',
  'mn',
  'mr',
  'ms',
  'mt',
  'my',
  'na',
  'nb',
  'nd',
  'ne',
  'ng',
  'nl',
  'nn',
  'no',
  'nr',
  'nv',
  'ny',
  'oc',
  'oj',
  'om',
  'or',
  'os',
  'pa',
  'pi',
  'pl',
  'ps',
  'pt',
  'qu',
  'rm',
  'rn',
  'ro',
  'ru',
  'rw',
  'sa',
  'sc',
  'sd',
  'se',
  'sg',
  'si',
  'sk',
  'sl',
  'sm',
  'sn',
  'so',
  'sq',
  'sr',
  'ss',
  'st',
  'su',
  'sv',
  'sw',
  'ta',
  'te',
  'tg',
  'th',
  'ti',
  'tk',
  'tl',
  'tn',
  'to',
  'tr',
  'ts',
  'tt',
  'tw',
  'ty',
  'ug',
  'uk',
  'ur',
  'uz',
  've',
  'vi',
  'vo',
  'wa',
  'wo',
  'xh',
  'yi',
  'yo',
  'za',
  'zh',
  'zu',
] as const;

const languageNames = new Intl.DisplayNames(['fr'], { type: 'language' });

export const LANGUAGES = ISO_639_1.map((code) => {
  const name = languageNames.of(code) ?? code;
  return { code, label: name.charAt(0).toLocaleUpperCase('fr') + name.slice(1) };
});

const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);

/**
 * Public fields a batch cooker may edit on their own `chef_profiles` row.
 *
 * Deliberately absent: `isActive` and `isVerified` (set at candidature approval
 * and by the dossier), `stripeAccountId` and `cronofyProfileId` (payout and
 * calendar wiring), and the SAP route, which was verified against documents during
 * the candidature. The intervention zones have their own route (`PATCH
 * /me/chef-profile/zones`). `avatarUrl` is on the account and set
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
