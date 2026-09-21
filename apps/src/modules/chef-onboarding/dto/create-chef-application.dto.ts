import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

  @ApiPropertyOptional({ nullable: true })
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

  @ApiPropertyOptional({ default: 'FR' })
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
  @ApiProperty({ example: '84' })
  @IsString()
  @Length(1, 3)
  regionCode!: string;

  @ApiProperty({ example: 'Auvergne-Rhône-Alpes' })
  @IsString()
  @Length(1, 120)
  regionLabel!: string;

  @ApiProperty({
    enum: ['region', 'cities'],
    description: '`cities` requires a non-empty `cities` array.',
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
  })
  @IsIn(['eu-citizen', 'residence-permit', 'renewal-pending', 'other'])
  status!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Required, and at least 10 characters, when `status` is `other`.',
  })
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  details?: string | null;
}

export class CompanySapDto {
  @ApiProperty({
    enum: ['type-a', 'type-b'],
    description: '`type-a` requires `declarationNumber`.',
  })
  @IsIn(['type-a', 'type-b'])
  path!: string;

  @ApiPropertyOptional({ nullable: true, example: 'SAP443061841' })
  @IsOptional()
  @IsString()
  declarationNumber?: string | null;
}

export class ApplicationCompanyDto {
  @ApiProperty({ enum: ['micro', 'other-company', 'not-registered'] })
  @IsIn(['micro', 'other-company', 'not-registered'])
  legalForm!: string;

  @ApiPropertyOptional({
    nullable: true,
    example: '44306184100047',
    description: '14 digits with a valid Luhn key. Required unless `not-registered`.',
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
  @ApiProperty({ description: 'Must be true.' })
  @IsBoolean()
  privacyPolicy!: boolean;

  @ApiProperty({ description: 'Must be true.' })
  @IsBoolean()
  terms!: boolean;

  @ApiProperty({
    example: '2026-09-20T09:12:00.000Z',
    description: 'Kept verbatim as proof of consent (retained 5 years).',
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
