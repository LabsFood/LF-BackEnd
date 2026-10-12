import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
} from 'class-validator';

import { SapDeclarationType, SapExternalStatus } from '../../../generated/prisma/client';

/**
 * How a chef is declared for "service à la personne" activity:
 * - `type_a_nova` — the chef holds their own NOVA declaration (`novaCode` required).
 * - `type_b_cooperative` — the chef declares through a cooperative such as Unipros
 *   (`cooperativeName` + `cooperativeMembershipProof` required).
 */
export const SAP_DECLARATION_TYPES = [
  'type_a_nova',
  'type_b_cooperative',
] as const satisfies readonly SapDeclarationType[];

/**
 * Fields a chef may set on their own `sap_profiles` row.
 *
 * `urssafTiersPrestationStatus` and `crcesuAffiliationStatus` are absent by design —
 * same rule as `isActive`/`isVerified` on `chef_profiles`: a chef must not be able to
 * declare themselves habilitated. Both stay `not_started` until the URSSAF and CRCESU
 * integrations exist and an admin flips them.
 */
export class UpdateMeSapProfileDto {
  @ApiProperty({
    enum: SAP_DECLARATION_TYPES,
    description:
      'Declaration route. `type_a_nova` requires `novaCode`; `type_b_cooperative` ' +
      'requires `cooperativeName` and `cooperativeMembershipProof`.',
    example: 'type_a_nova',
  })
  @IsIn(SAP_DECLARATION_TYPES)
  declarationType!: SapDeclarationType;

  @ApiPropertyOptional({
    maxLength: 64,
    description:
      'NOVA declaration number. Required when `declarationType` is `type_a_nova`.',
    example: 'SAP123456789',
  })
  @ValidateIf((dto: UpdateMeSapProfileDto) => dto.declarationType === 'type_a_nova')
  @IsString()
  @IsNotEmpty()
  @Length(1, 64)
  novaCode?: string;

  @ApiPropertyOptional({
    maxLength: 255,
    description:
      'Cooperative the chef declares through. Required when `declarationType` is ' +
      '`type_b_cooperative`.',
    example: 'Unipros',
  })
  @ValidateIf(
    (dto: UpdateMeSapProfileDto) => dto.declarationType === 'type_b_cooperative',
  )
  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  cooperativeName?: string;

  @ApiPropertyOptional({
    maxLength: 512,
    description:
      'URL or storage key of the membership proof. Required when `declarationType` is ' +
      '`type_b_cooperative`.',
    example: 'https://files.labsfood.fr/sap/unipros-membership-2026.pdf',
  })
  @ValidateIf(
    (dto: UpdateMeSapProfileDto) => dto.declarationType === 'type_b_cooperative',
  )
  @IsString()
  @IsNotEmpty()
  @Length(1, 512)
  cooperativeMembershipProof?: string;

  @ApiPropertyOptional({
    maxLength: 64,
    description:
      'CRCESU national affiliation number (NAN), if the chef already has one. ' +
      'Optional for both declaration types.',
    example: '1234567',
  })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  crcesuNan?: string;
}

/** `GET` / `PATCH /me/chef-profile/sap` response. */
export class SapProfileDto {
  @ApiProperty({ format: 'uuid', description: 'SAP profile primary key.' })
  id!: string;

  @ApiProperty({ format: 'uuid', description: 'Owning `chef_profiles.id`.' })
  chefProfileId!: string;

  @ApiProperty({ enum: SAP_DECLARATION_TYPES, description: 'Declaration route.' })
  declarationType!: SapDeclarationType;

  @ApiPropertyOptional({ nullable: true, description: 'NOVA declaration number.' })
  novaCode?: string | null;

  @ApiProperty({
    enum: ['not_started', 'pending', 'active'],
    description:
      'URSSAF "tiers de prestation" habilitation. Inert — no integration writes it yet.',
    example: 'not_started',
  })
  urssafTiersPrestationStatus!: SapExternalStatus;

  @ApiPropertyOptional({ nullable: true, description: 'Cooperative name (type B).' })
  cooperativeName?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Membership proof URL or storage key (type B).',
  })
  cooperativeMembershipProof?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'CRCESU affiliation number.' })
  crcesuNan?: string | null;

  @ApiProperty({
    enum: ['not_started', 'pending', 'active'],
    description: 'CRCESU affiliation. Inert — no integration writes it yet.',
    example: 'not_started',
  })
  crcesuAffiliationStatus!: SapExternalStatus;
}
