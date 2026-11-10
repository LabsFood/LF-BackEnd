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
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
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

/** One entry of an editable list: a stable code, the label shown. */
class ListItemDto {
  @ApiProperty({
    maxLength: 40,
    description: 'Lowercase letters, digits, `-` and `_`. Stored on each dish.',
    example: 'oven',
  })
  @IsString()
  @Matches(/^[a-z0-9_-]{1,40}$/)
  code!: string;

  @ApiProperty({ maxLength: 60, example: 'Four' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  label!: string;
}

class ReheatModesDto {
  @ApiProperty({ type: [ListItemDto], description: 'The whole list, 1 to 30 modes.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ListItemDto)
  modes!: ListItemDto[];
}

class RecipeProfilesDto {
  @ApiProperty({ type: [ListItemDto], description: 'The whole list, 1 to 30 profiles.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ListItemDto)
  profiles!: ListItemDto[];
}

const RECIPE_PROFILES_EXAMPLE = {
  profiles: [
    { code: 'kids', label: 'Adapté aux enfants' },
    { code: 'budget', label: 'Petit budget' },
  ],
  updatedAt: '2026-11-02T09:00:00.000Z',
};

const REHEAT_MODES_EXAMPLE = {
  modes: [
    { code: 'oven', label: 'Four' },
    { code: 'microwave', label: 'Micro-ondes' },
  ],
  updatedAt: '2026-11-02T09:00:00.000Z',
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
    summary: 'Read the chef tiers: names, what each may do, commission',
    description:
      'The name shown for each of the four tier codes (`tier_1` to `tier_4`) set on a ' +
      'batch cooker with `PATCH /admin/chefs/{id}/tier`. `updatedAt: null`: never ' +
      'changed, the neutral names apply ("Palier 1" to "Palier 4"). `rules` says what ' +
      'each tier may do and the commission it pays: today `tier_1` has every ' +
      'capability at the platform commission (`decided: true`); the other tiers are ' +
      'not decided (`decided: false`) and restrict nothing yet.',
  })
  @ApiOkResponse({
    description: 'The names and the rules.',
    example: {
      ...CHEF_TIERS_EXAMPLE,
      rules: {
        tier_1: {
          decided: true,
          commissionBps: 1500,
          capabilities: [
            { code: 'publish_dishes', label: 'Écrire et publier ses plats' },
          ],
        },
        tier_2: {
          decided: false,
          commissionBps: 1500,
          capabilities: [
            { code: 'publish_dishes', label: 'Écrire et publier ses plats' },
          ],
        },
      },
    },
  })
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

  @Get('referentials/reheat-modes')
  @ApiTags(TAGS.referentials)
  @ApiOperation({
    summary: 'List the reheating modes',
    description:
      'What `recipe.reheating.modes` takes (Recettes §4.6). The list is edited in ' +
      'the console. Public.',
  })
  @ApiOkResponse({
    description: 'The modes, as code and label.',
    example: REHEAT_MODES_EXAMPLE,
  })
  reheatModes() {
    return this.settings.reheatModes();
  }

  @Get('admin/settings/reheat-modes')
  @ApiTags(TAGS.adminContent)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Read the reheating modes',
    description: '`updatedAt: null`: never changed, the default list applies.',
  })
  @ApiOkResponse({ description: 'The modes.', example: REHEAT_MODES_EXAMPLE })
  @ApiAdminAuthResponses()
  adminReheatModes() {
    return this.settings.reheatModes();
  }

  @Put('admin/settings/reheat-modes')
  @ApiTags(TAGS.adminContent)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Change the reheating modes',
    description:
      'The whole list, every time, each code once (else 422 `VALIDATION_FAILED`). A ' +
      'dish keeps a code removed from the list; it is refused when the dish is saved ' +
      'again. Changing a mode never makes a new recipe version. Recorded in the audit ' +
      'log.',
  })
  @ApiOkResponse({ description: 'The new list.', example: REHEAT_MODES_EXAMPLE })
  @ApiAdminAuthResponses()
  async setReheatModes(
    @CurrentClerkUser() user: ClerkUser,
    @Body() body: ReheatModesDto,
    @Req() req: { id?: unknown },
  ) {
    const admin =
      (await this.users.findByClerkId(user.userId)) ??
      (await this.users.ensurePersistedFromClerk(user.userId));
    return this.settings.setReheatModes(body.modes, admin.id, reqId(req));
  }

  @Get('referentials/recipe-profiles')
  @ApiTags(TAGS.referentials)
  @ApiOperation({
    summary: 'List the recipe profiles',
    description:
      'What `profiles` takes on a dish (Recettes §4.8): adapted to children, sport… ' +
      'The list is edited in the console. Public.',
  })
  @ApiOkResponse({ description: 'The profiles.', example: RECIPE_PROFILES_EXAMPLE })
  recipeProfiles() {
    return this.settings.recipeProfiles();
  }

  @Get('admin/settings/recipe-profiles')
  @ApiTags(TAGS.adminContent)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Read the recipe profiles',
    description: '`updatedAt: null`: never changed, the PRD’s examples apply.',
  })
  @ApiOkResponse({ description: 'The profiles.', example: RECIPE_PROFILES_EXAMPLE })
  @ApiAdminAuthResponses()
  adminRecipeProfiles() {
    return this.settings.recipeProfiles();
  }

  @Put('admin/settings/recipe-profiles')
  @ApiTags(TAGS.adminContent)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Change the recipe profiles',
    description:
      'The whole list, every time, each code once (else 422 `VALIDATION_FAILED`). A ' +
      'dish keeps a code removed from the list; it is refused when the dish is saved ' +
      'again. Recorded in the audit log.',
  })
  @ApiOkResponse({ description: 'The new list.', example: RECIPE_PROFILES_EXAMPLE })
  @ApiAdminAuthResponses()
  async setRecipeProfiles(
    @CurrentClerkUser() user: ClerkUser,
    @Body() body: RecipeProfilesDto,
    @Req() req: { id?: unknown },
  ) {
    const admin =
      (await this.users.findByClerkId(user.userId)) ??
      (await this.users.ensurePersistedFromClerk(user.userId));
    return this.settings.setRecipeProfiles(body.profiles, admin.id, reqId(req));
  }
}
