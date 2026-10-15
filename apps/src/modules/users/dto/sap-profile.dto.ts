import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
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

export const SAP_EXTERNAL_STATUSES = [
  'not_started',
  'pending',
  'active',
] as const satisfies readonly SapExternalStatus[];

/**
 * Fields a chef may set on their own `sap_profiles` row.
 *
 * `urssafTiersPrestationStatus` and `crcesuAffiliationStatus` are absent by design —
 * same rule as `isActive`/`isVerified` on `chef_profiles`: a chef must not be able to
 * declare themselves habilitated. An admin writes them through
 * `PATCH /admin/chefs/:id/sap-external-status`; there is no CRCESU API to write them from.
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

  @ApiPropertyOptional({
    description:
      'Opt in to being paid in prefinanced CESU. Takes effect only alongside a ' +
      '`crcesuNan`: without the number a client cannot add you as an intervenant on ' +
      'their issuer portal, so accepting the method would be a dead end. Accepting also ' +
      'means the platform commission on those bookings is collected from you by SEPA ' +
      'direct debit, since the funds never pass through the platform.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  acceptsCesu?: boolean;
}

/**
 * Admin body for `PATCH /admin/chefs/:id/sap-external-status`.
 *
 * These two statuses are absent from every self-service DTO — same rule as
 * `isActive` / `isVerified`: no self-habilitation. Until this endpoint existed nothing
 * could write `crcesuAffiliationStatus` at all.
 */
export class UpdateSapExternalStatusDto {
  @ApiPropertyOptional({
    enum: SAP_EXTERNAL_STATUSES,
    description: 'CRCESU affiliation, as confirmed by the CRCESU.',
    example: 'active',
  })
  @IsOptional()
  @IsIn(SAP_EXTERNAL_STATUSES)
  crcesuAffiliationStatus?: SapExternalStatus;

  @ApiPropertyOptional({
    enum: SAP_EXTERNAL_STATUSES,
    description: 'URSSAF "tiers de prestation" habilitation.',
    example: 'pending',
  })
  @IsOptional()
  @IsIn(SAP_EXTERNAL_STATUSES)
  urssafTiersPrestationStatus?: SapExternalStatus;
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
    enum: SAP_EXTERNAL_STATUSES,
    description:
      'URSSAF "tiers de prestation" habilitation, admin-maintained through ' +
      '`PATCH /admin/chefs/:id/sap-external-status`.',
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
    enum: SAP_EXTERNAL_STATUSES,
    description:
      'CRCESU affiliation, admin-maintained through ' +
      '`PATCH /admin/chefs/:id/sap-external-status`. No integration writes it — there is ' +
      'no CRCESU API to write it from.',
    example: 'not_started',
  })
  crcesuAffiliationStatus!: SapExternalStatus;

  @ApiProperty({
    description:
      'Whether the chef accepts prefinanced CESU. Effective only with a `crcesuNan`.',
    example: false,
  })
  acceptsCesu!: boolean;
}
