import { ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { METROPOLITAN_REGIONS } from '../../chef-onboarding/domain/chef-onboarding.rules';
import { CreateChefApplicationDto } from '../../chef-onboarding/dto/create-chef-application.dto';

/** Body of `PATCH /admin/chefs/{id}/zones`: the candidature's own field, same rules. */
export class UpdateChefZonesDto extends PickType(CreateChefApplicationDto, [
  'interventionZones',
] as const) {}

/**
 * Where a batch cooker stands, from the three columns that decide it. Each
 * profile is in exactly one.
 */
export const CHEF_STATES = ['online', 'offline', 'suspended', 'pending'] as const;
export type ChefState = (typeof CHEF_STATES)[number];

/** `verified` is the network: everyone approved, whatever their storefront does. */
export const CHEF_STATE_FILTERS = [...CHEF_STATES, 'verified'] as const;
export type ChefStateFilter = (typeof CHEF_STATE_FILTERS)[number];

export const CHEF_SORTS = ['recent', 'name'] as const;

export const CHEF_STATE_HELP =
  '`online`: verified and bookable. `offline`: verified, storefront off. ' +
  '`suspended`: taken offline automatically because a required document expired. ' +
  '`pending`: account created, candidature not approved yet.';

const REGION_CODES = METROPOLITAN_REGIONS.map((r) => r.code);

export class ListAdminChefsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Searches the display name, the account name and email, the city and the ' +
      'candidature reference. Case-insensitive.',
    example: 'marie',
    maxLength: 120,
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({
    enum: CHEF_STATE_FILTERS,
    description: `${CHEF_STATE_HELP} \`verified\`: the first three together.`,
  })
  @IsOptional()
  @IsIn(CHEF_STATE_FILTERS)
  state?: ChefStateFilter;

  @ApiPropertyOptional({
    enum: REGION_CODES,
    description:
      'Keeps the batch cookers who declared this region among the ones they cover ' +
      '(`GET /referentials/regions` lists the codes).',
    example: '93',
  })
  @IsOptional()
  @IsIn(REGION_CODES)
  region?: string;

  @ApiPropertyOptional({
    enum: CHEF_SORTS,
    default: 'recent',
    description: '`recent`: newest account first. `name`: by display name.',
  })
  @IsOptional()
  @IsIn(CHEF_SORTS)
  sort?: (typeof CHEF_SORTS)[number];
}
