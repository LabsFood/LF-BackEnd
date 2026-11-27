import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';

/**
 * Body of `POST /chef-applications` (FLOW-01 §2) — exactly what the `/devenir-chef`
 * form produces.
 *
 * Wire values are kebab-case; the service maps them onto the snake_case Postgres
 * enums. Cross-field rules (SIRET required unless unregistered, `details` required
 * when the status is `other`) live in the service, where the whole body is visible.
 */

export class ApplicationIdentityDto {
  @ApiProperty({ example: 'Marie' })
  @IsString()
  @Length(1, 120)
  firstName!: string;

  @ApiProperty({ example: 'Dupont' })
  @IsString()
  @Length(1, 120)
  lastName!: string;

  @ApiProperty({ example: 'marie.dupont@exemple.fr' })
  @IsEmail()
  @Length(1, 320)
  email!: string;

  @ApiProperty({
    example: '+33612345678',
    description: 'E.164, normalised by the frontend. The API revalidates.',
  })
  @Matches(/^\+[1-9]\d{7,14}$/, { message: 'phone must be a valid E.164 number.' })
  phone!: string;
}

export class ApplicationAddressDto {
  @ApiProperty({ example: '12 rue des Lilas' })
  @IsString()
  @Length(1, 255)
  street!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Building, floor, apartment.',
    example: 'Bâtiment B, 3e étage',
  })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  line2?: string | null;

  @ApiProperty({
    example: '69003',
    description: 'Five digits, metropolitan France including Corsica (01000–95999).',
  })
  @IsString()
  @Length(5, 5)
  postcode!: string;

  @ApiProperty({ example: 'Lyon' })
  @IsString()
  @Length(1, 120)
  city!: string;

  @ApiPropertyOptional({
    default: 'FR',
    description: 'Two-letter country code. Only France is served.',
    example: 'FR',
  })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  country?: string;
}

export class InterventionCityDto {
  @ApiProperty({ example: 'Lyon' })
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiProperty({ example: '69' })
  @IsString()
  @Length(1, 3)
  dept!: string;

  @ApiProperty({ example: '69123', description: 'INSEE commune code.' })
  @IsString()
  @Length(1, 10)
  insee!: string;
}

export class InterventionZoneDto {
  @ApiProperty({
    description: 'A region code from `GET /referentials/regions`.',
    example: '84',
  })
  @IsString()
  @Length(1, 3)
  regionCode!: string;

  @ApiProperty({ example: 'Auvergne-Rhône-Alpes' })
  @IsString()
  @Length(1, 120)
  regionLabel!: string;

  @ApiProperty({
    enum: ['region', 'cities'],
    description:
      '`region`: the whole region, `cities` left empty. `cities`: only the towns listed ' +
      'in `cities`, at least one.',
    example: 'cities',
  })
  @IsIn(['region', 'cities'])
  scope!: 'region' | 'cities';

  @ApiProperty({ type: [InterventionCityDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InterventionCityDto)
  cities!: InterventionCityDto[];
}

export class WorkAuthorizationDto {
  @ApiProperty({
    enum: ['eu-citizen', 'residence-permit', 'renewal-pending', 'other'],
    description:
      'Right to work in France. `eu-citizen`: French or EU citizen. ' +
      '`residence-permit`: a residence permit that allows work (asks for the permit). ' +
      '`renewal-pending`: the permit is being renewed (asks for the receipt). ' +
      '`other`: explain in `details` (asks for a proof).',
    example: 'eu-citizen',
  })
  @IsIn(['eu-citizen', 'residence-permit', 'renewal-pending', 'other'])
  status!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Only with `status: other`, and then required: at least 10 characters.',
    example: null,
  })
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  details?: string | null;
}

export class CompanySapDto {
  @ApiProperty({
    enum: ['type-a'],
    description:
      'Who holds the "services à la personne" declaration: the batch cooker, always ' +
      '(27/11/2026: the cooperative route is closed). `type-a`: they give their number ' +
      'in `declarationNumber` and deposit the `sap-declaration` receipt. Without one, ' +
      'Lab’s Food onboards no one.',
    example: 'type-a',
  })
  @IsIn(['type-a'])
  path!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Only with `path: type-a`, and then required: `SAP` and 9 digits.',
    example: 'SAP443061841',
  })
  @IsOptional()
  @IsString()
  declarationNumber?: string | null;
}

export class ApplicationCompanyDto {
  @ApiProperty({
    enum: ['micro', 'other-company', 'not-registered'],
    description:
      '`micro`: micro-entrepreneur. `other-company`: any other business (EI, EURL, ' +
      'SASU, SAS…). `not-registered`: no business yet; the candidature is accepted, ' +
      'but approval waits for one.',
    example: 'micro',
  })
  @IsIn(['micro', 'other-company', 'not-registered'])
  legalForm!: string;

  @ApiPropertyOptional({
    nullable: true,
    example: '44306184100047',
    description:
      'The 14-digit business number, checked with its Luhn key. Required, except with ' +
      '`not-registered`, where it must be left out.',
  })
  @IsOptional()
  @IsString()
  siret?: string | null;

  @ApiProperty({ type: CompanySapDto })
  @ValidateNested()
  @Type(() => CompanySapDto)
  sap!: CompanySapDto;
}

export class ApplicationConsentDto {
  @ApiProperty({
    description: 'Accepted the privacy policy. Must be `true`.',
    example: true,
  })
  @IsBoolean()
  privacyPolicy!: boolean;

  @ApiProperty({ description: 'Accepted the terms. Must be `true`.', example: true })
  @IsBoolean()
  terms!: boolean;

  @ApiProperty({
    example: '2026-09-20T09:12:00.000Z',
    description: 'When the boxes were ticked. Kept as proof of consent for 5 years.',
  })
  @IsDateString()
  acceptedAt!: string;
}

export class CreateChefApplicationDto {
  @ApiProperty({ type: ApplicationIdentityDto })
  @ValidateNested()
  @Type(() => ApplicationIdentityDto)
  identity!: ApplicationIdentityDto;

  @ApiProperty({ type: ApplicationAddressDto })
  @ValidateNested()
  @Type(() => ApplicationAddressDto)
  address!: ApplicationAddressDto;

  @ApiProperty({ type: [InterventionZoneDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one intervention zone is required.' })
  @ValidateNested({ each: true })
  @Type(() => InterventionZoneDto)
  interventionZones!: InterventionZoneDto[];

  @ApiProperty({ type: WorkAuthorizationDto })
  @ValidateNested()
  @Type(() => WorkAuthorizationDto)
  workAuthorization!: WorkAuthorizationDto;

  @ApiProperty({ type: ApplicationCompanyDto })
  @ValidateNested()
  @Type(() => ApplicationCompanyDto)
  company!: ApplicationCompanyDto;

  @ApiProperty({ type: ApplicationConsentDto })
  @ValidateNested()
  @Type(() => ApplicationConsentDto)
  consent!: ApplicationConsentDto;
}

/**
 * Body of `POST /admin/chef-applications`: the same form, filled in by an admin for
 * the batch cooker. No `consent` block: an admin cannot accept the terms for someone
 * else, so the stored proof says nothing was accepted.
 */
export class CreateChefApplicationByAdminDto extends OmitType(CreateChefApplicationDto, [
  'consent',
] as const) {}
