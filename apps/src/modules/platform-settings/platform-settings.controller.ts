import { Body, Controller, Get, Patch, Put, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import {
  ApiAdminAuthResponses,
  ApiClerkAuthResponses,
} from '../../common/swagger/auth-responses';
import { TAGS } from '../../common/swagger/tags';
import { UsersService } from '../users/users.service';
import { PlatformSettingsService } from './platform-settings.service';

/** Half the client price at most: above that the setting is a typing mistake. */
const MAX_COMMISSION_BPS = 5000;

class UpdateCommissionDto {
  @ApiProperty({
    minimum: 0,
    maximum: MAX_COMMISSION_BPS,
    description: 'The commission in basis points: `1500` is 15 %.',
    example: 1500,
  })
  @IsInt()
  @Min(0)
  @Max(MAX_COMMISSION_BPS)
  commissionBps!: number;
}

class BookingSupplementsDto {
  @ApiProperty({
    minimum: 0,
    maximum: 50,
    description: 'Adults an offer’s price covers.',
    example: 3,
  })
  @IsInt()
  @Min(0)
  @Max(50)
  includedPersons!: number;

  @ApiProperty({
    minimum: 0,
    maximum: 100_000,
    description: 'Each adult beyond, in cents.',
    example: 1500,
  })
  @IsInt()
  @Min(0)
  @Max(100_000)
  extraPersonCents!: number;

  @ApiProperty({
    minimum: 0,
    maximum: 100_000,
    description: 'Each extra dish (the "Plats supp." counter), in cents.',
    example: 800,
  })
  @IsInt()
  @Min(0)
  @Max(100_000)
  extraMealCents!: number;
}

const SUPPLEMENTS_EXAMPLE = {
  includedPersons: 3,
  extraPersonCents: 1500,
  extraMealCents: 800,
  updatedAt: '2026-10-18T09:00:00.000Z',
};

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** The name shown for each tier code. All four, every time. */
class ChefTierLabelsDto {
  @ApiProperty({ maxLength: 40, example: 'Découverte' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  tier_1!: string;

  @ApiProperty({ maxLength: 40, example: 'Confirmé' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  tier_2!: string;

  @ApiProperty({ maxLength: 40, example: 'Expert' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  tier_3!: string;

  @ApiProperty({ maxLength: 40, example: 'Partenaire' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  tier_4!: string;
}

class ChefTiersDto {
  @ApiProperty({ type: ChefTierLabelsDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => ChefTierLabelsDto)
  labels!: ChefTierLabelsDto;
}

const CHEF_TIERS_EXAMPLE = {
  labels: {
    tier_1: 'Découverte',
    tier_2: 'Confirmé',
    tier_3: 'Expert',
    tier_4: 'Partenaire',
  },
  updatedAt: '2026-10-31T09:00:00.000Z',
};

const reqId = (req: { id?: unknown }): string | undefined =>
  typeof req.id === 'string' ? req.id : undefined;

@Controller()
export class PlatformSettingsController {
  constructor(
    private readonly settings: PlatformSettingsService,
    private readonly users: UsersService,
  ) {}

  @Get('pricing-rules')
  @ApiTags(TAGS.quotes)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard)
  @ApiOperation({
    summary: 'Read how a net becomes a client price',
    description:
      'For the screens that preview a price while it is typed. `commissionBps` is ' +
      'the platform commission and `taxCreditBps` the "services à la personne" tax ' +
      'credit, both in basis points (`1500` = 15 %).\n\n' +
      'The client price is `net × 10000 / (10000 − commissionBps)`, and what the ' +
      'client bears after the credit is `clientPrice × (10000 − taxCreditBps) / 10000`. ' +
      'A preview only: the amounts that count are the ones the API returns on the ' +
      'offer.',
  })
  @ApiOkResponse({
    description: 'The rates.',
    example: { commissionBps: 1500, taxCreditBps: 5000 },
  })
  @ApiClerkAuthResponses()
  pricingRules() {
    return this.settings.pricingRules();
  }

  @Get('admin/settings/commission')
  @ApiTags(TAGS.adminQuotes)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({ summary: 'Read the platform commission' })
  @ApiOkResponse({
    description: 'The rate, and when it last changed (`null`: never).',
    example: { commissionBps: 1500, updatedAt: '2026-10-12T09:00:00.000Z' },
  })
  @ApiAdminAuthResponses()
  commission() {
    return this.settings.commission();
  }

  @Patch('admin/settings/commission')
  @ApiTags(TAGS.adminQuotes)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Change the platform commission',
    description:
      'Applies to what is priced from now on. An offer already sent keeps the rate ' +
      'it was priced with, stored on it. Recorded in the audit log.',
  })
  @ApiOkResponse({
    description: 'The new rate.',
    example: { commissionBps: 1200, updatedAt: '2026-10-12T09:00:00.000Z' },
  })
  @ApiAdminAuthResponses()
  async setCommission(
    @CurrentClerkUser() user: ClerkUser,
    @Body() body: UpdateCommissionDto,
    @Req() req: { id?: unknown },
  ) {
    const admin =
      (await this.users.findByClerkId(user.userId)) ??
      (await this.users.ensurePersistedFromClerk(user.userId));
    return this.settings.setCommission(body.commissionBps, admin.id, reqId(req));
  }

  @Get('admin/settings/booking-supplements')
  @ApiTags(TAGS.adminBookings)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Read the booking supplements',
    description:
      'The adults an offer’s price covers, what each one beyond costs, and what an ' +
      'extra dish costs. ' +
      '`updatedAt: null`: never changed, the defaults apply.',
  })
  @ApiOkResponse({ description: 'The rules.', example: SUPPLEMENTS_EXAMPLE })
  @ApiAdminAuthResponses()
  bookingSupplements() {
    return this.settings.bookingSupplements();
  }

  @Put('admin/settings/booking-supplements')
  @ApiTags(TAGS.adminBookings)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Change the booking supplements',
    description:
      'All three values, every time. Applies to bookings made, or whose adults or ' +
      'dishes change, from now on; a booking keeps the lines it has. Recorded in the ' +
      'audit log.',
  })
  @ApiOkResponse({ description: 'The new rules.', example: SUPPLEMENTS_EXAMPLE })
  @ApiAdminAuthResponses()
  async setBookingSupplements(
    @CurrentClerkUser() user: ClerkUser,
    @Body() body: BookingSupplementsDto,
    @Req() req: { id?: unknown },
  ) {
    const admin =
      (await this.users.findByClerkId(user.userId)) ??
      (await this.users.ensurePersistedFromClerk(user.userId));
    return this.settings.setBookingSupplements(body, admin.id, reqId(req));
  }

  @Get('admin/settings/chef-tiers')
  @ApiTags(TAGS.adminChefs)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Read the names of the chef tiers',
    description:
      'The name shown for each of the four tier codes (`tier_1` to `tier_4`) set on a ' +
      'batch cooker with `PATCH /admin/chefs/{id}/tier`. `updatedAt: null`: never ' +
      'changed, the neutral names apply ("Palier 1" to "Palier 4").',
  })
  @ApiOkResponse({ description: 'The names.', example: CHEF_TIERS_EXAMPLE })
  @ApiAdminAuthResponses()
  chefTiers() {
    return this.settings.chefTiers();
  }

  @Put('admin/settings/chef-tiers')
  @ApiTags(TAGS.adminChefs)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Rename the chef tiers',
    description:
      'All four names, every time, 40 characters at most. Only the names change: ' +
      'each batch cooker keeps their tier code. Recorded in the audit log.',
  })
  @ApiOkResponse({ description: 'The new names.', example: CHEF_TIERS_EXAMPLE })
  @ApiAdminAuthResponses()
  async setChefTiers(
    @CurrentClerkUser() user: ClerkUser,
    @Body() body: ChefTiersDto,
    @Req() req: { id?: unknown },
  ) {
    const admin =
      (await this.users.findByClerkId(user.userId)) ??
      (await this.users.ensurePersistedFromClerk(user.userId));
    return this.settings.setChefTiers(body.labels, admin.id, reqId(req));
  }
}
