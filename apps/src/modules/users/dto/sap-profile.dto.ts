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
 * - `type_b_cooperative` — the chef declares through a cooperative such as a SAP cooperative
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
 * `urssafTiersPrestationStatus` is absent by design —
 * same rule as `isActive`/`isVerified` on `chef_profiles`: a chef must not be able to
 * declare themselves habilitated. An admin writes them through
 * `PATCH /admin/chefs/:id/sap-external-status`. Batch cookers hold no CRCESU affiliation:
 * prefinanced CESU is paid to the platform (`payments/cesu-collector.ts`).
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
    example: 'Coop SAP',
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
    example: 'https://files.labsfood.fr/sap/coop-membership-2026.pdf',
  })
  @ValidateIf(
    (dto: UpdateMeSapProfileDto) => dto.declarationType === 'type_b_cooperative',
  )
  @IsString()
  @IsNotEmpty()
  @Length(1, 512)
  cooperativeMembershipProof?: string;

  @ApiPropertyOptional({
    description:
      'Opt in to being paid in prefinanced CESU. The client pays the platform’s own ' +
      'CRCESU affiliation: batch cookers no longer need a NAN.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  acceptsCesu?: boolean;
}

/**
 * Admin body for `PATCH /admin/chefs/:id/sap-external-status`.
 *
 * This status is absent from every self-service DTO — same rule as
 * `isActive` / `isVerified`: no self-habilitation.
 */
export class UpdateSapExternalStatusDto {
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
  @ApiProperty({
    example: '7b3c5d1e-2f4a-4b6c-8d9e-0a1b2c3d4e5f',
    format: 'uuid',
    description: 'SAP profile primary key.',
  })
  id!: string;

  @ApiProperty({
    example: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
    format: 'uuid',
    description: 'Owning `chef_profiles.id`.',
  })
  chefProfileId!: string;

  @ApiProperty({ enum: SAP_DECLARATION_TYPES, description: 'Declaration route.' })
  declarationType!: SapDeclarationType;

  @ApiPropertyOptional({
    example: 'SAP912345678',
    nullable: true,
    description: 'NOVA declaration number.',
  })
  novaCode?: string | null;

  @ApiProperty({
    enum: SAP_EXTERNAL_STATUSES,
    description:
      'URSSAF "tiers de prestation" habilitation, admin-maintained through ' +
      '`PATCH /admin/chefs/:id/sap-external-status`.',
    example: 'not_started',
  })
  urssafTiersPrestationStatus!: SapExternalStatus;

  @ApiPropertyOptional({
    example: null,
    nullable: true,
    description: 'Cooperative name (type B).',
  })
  cooperativeName?: string | null;

  @ApiPropertyOptional({
    example: null,
    nullable: true,
    description: 'Membership proof URL or storage key (type B).',
  })
  cooperativeMembershipProof?: string | null;

  @ApiProperty({
    description: 'Whether the chef accepts prefinanced CESU, paid to the platform NAN.',
    example: false,
  })
  acceptsCesu!: boolean;
}
