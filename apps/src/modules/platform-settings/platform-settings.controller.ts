import { Body, Controller, Get, Patch, Put, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsInt,
  IsNotEmpty,
  IsOptional,
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
import { Raw } from '../../common/dto/strict';
import { TAGS } from '../../common/swagger/tags';
import { UsersService } from '../users/users.service';
import { PlatformSettingsService } from './platform-settings.service';
import { FRIDGE_ALERT_MAX, FRIDGE_ALERT_MIN } from './fridge-alert';
import { GROCERIES_BOUNDS } from './groceries';

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

/** Recettes lot 6, groundwork: the Budget Courses cap and the advised forfait courses. */
class GroceriesDto {
  @ApiProperty({
    minimum: GROCERIES_BOUNDS.budgetMaxCents.min,
    maximum: GROCERIES_BOUNDS.budgetMaxCents.max,
    description: 'The most a client may set as their Budget Courses, in cents.',
    example: 10_000,
  })
  @IsInt()
  @Min(GROCERIES_BOUNDS.budgetMaxCents.min)
  @Max(GROCERIES_BOUNDS.budgetMaxCents.max)
  budgetMaxCents!: number;

  @ApiProperty({
    minimum: GROCERIES_BOUNDS.recommendedShoppingFeeMinCents.min,
    maximum: GROCERIES_BOUNDS.recommendedShoppingFeeMinCents.max,
    description:
      'The forfait courses a batch cooker is advised to charge at least, in cents. ' +
      'A recommendation: a lower fee is never refused.',
    example: 1_500,
  })
  @IsInt()
  @Min(GROCERIES_BOUNDS.recommendedShoppingFeeMinCents.min)
  @Max(GROCERIES_BOUNDS.recommendedShoppingFeeMinCents.max)
  recommendedShoppingFeeMinCents!: number;

  @ApiPropertyOptional({
    minimum: GROCERIES_BOUNDS.minCancelNoticeMinutes.min,
    maximum: GROCERIES_BOUNDS.minCancelNoticeMinutes.max,
    description:
      'Lot 6: the cancel deadline of the message before the groceries is at least this ' +
      'many minutes after the message. Left out: unchanged.',
    example: 120,
  })
  @IsOptional()
  @IsInt()
  @Min(GROCERIES_BOUNDS.minCancelNoticeMinutes.min)
  @Max(GROCERIES_BOUNDS.minCancelNoticeMinutes.max)
  minCancelNoticeMinutes?: number;

  @ApiPropertyOptional({
    description:
      'Lot 6, art. 8: « le silence vaut confirmation ». Off (the default), the client ' +
      'must confirm the groceries. Left out: unchanged.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  silenceConfirms?: boolean;

  @ApiPropertyOptional({
    minimum: GROCERIES_BOUNDS.instantPayoutFeeBps.min,
    maximum: GROCERIES_BOUNDS.instantPayoutFeeBps.max,
    description: 'Lot 6: the instant payout fee, in basis points, paid by the chef.',
    example: 150,
  })
  @IsOptional()
  @IsInt()
  @Min(GROCERIES_BOUNDS.instantPayoutFeeBps.min)
  @Max(GROCERIES_BOUNDS.instantPayoutFeeBps.max)
  instantPayoutFeeBps?: number;

  @ApiPropertyOptional({
    minimum: GROCERIES_BOUNDS.instantPayoutFeeMinCents.min,
    maximum: GROCERIES_BOUNDS.instantPayoutFeeMinCents.max,
    description: 'Lot 6: the least an instant payout costs, in cents.',
    example: 50,
  })
  @IsOptional()
  @IsInt()
  @Min(GROCERIES_BOUNDS.instantPayoutFeeMinCents.min)
  @Max(GROCERIES_BOUNDS.instantPayoutFeeMinCents.max)
  instantPayoutFeeMinCents?: number;
}

/** Recettes lot 3 (LF-0271): days in the fridge past which a dish's date alerts. */
class FridgeAlertDto {
  @ApiProperty({
    minimum: FRIDGE_ALERT_MIN,
    maximum: FRIDGE_ALERT_MAX,
    description: 'Days in the fridge past which a dish’s « à manger avant » date alerts.',
    example: 4,
  })
  @IsInt()
  @Min(FRIDGE_ALERT_MIN)
  @Max(FRIDGE_ALERT_MAX)
  days!: number;
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
  @Raw()
  @IsString()
  @Matches(/^[a-z0-9_-]{1,40}$/)
  code!: string;

  @ApiProperty({ maxLength: 60, example: 'Four' })
  @Raw()
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

export class AislesDto {
  @ApiProperty({
    type: [ListItemDto],
    description: 'The whole list in store order, 1 to 30 aisles.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ListItemDto)
  aisles!: ListItemDto[];
}

const AISLES_EXAMPLE = {
  aisles: [
    { code: 'fruits-legumes', label: 'Fruits et légumes (y compris herbes fraîches)' },
    { code: 'boulangerie', label: 'Boulangerie' },
  ],
  updatedAt: '2026-11-04T09:00:00.000Z',
};

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

  @Get('admin/settings/groceries')
  @ApiTags(TAGS.adminBookings)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Read the grocery amounts',
    description:
      'Recettes lot 6, groundwork: the Budget Courses cap (100 € by default) and the ' +
      'forfait courses advised to batch cookers (15 € by default). Both are also in ' +
      '`GET /pricing-rules` (`groceries`). `updatedAt: null`: never changed.',
  })
  @ApiOkResponse({
    description: 'The amounts.',
    example: {
      budgetMaxCents: 10_000,
      recommendedShoppingFeeMinCents: 1_500,
      updatedAt: null,
    },
  })
  @ApiAdminAuthResponses()
  groceries() {
    return this.settings.groceries();
  }

  @Put('admin/settings/groceries')
  @ApiTags(TAGS.adminBookings)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Change the grocery amounts',
    description:
      'Both values, every time. Read by the forms from now on; nothing stored on a ' +
      'booking or an offer changes. Recorded in the audit log.',
  })
  @ApiOkResponse({
    description: 'The new amounts.',
    example: {
      budgetMaxCents: 12_000,
      recommendedShoppingFeeMinCents: 1_500,
      updatedAt: '2026-11-15T09:00:00.000Z',
    },
  })
  @ApiAdminAuthResponses()
  async setGroceries(
    @CurrentClerkUser() user: ClerkUser,
    @Body() body: GroceriesDto,
    @Req() req: { id?: unknown },
  ) {
    const admin =
      (await this.users.findByClerkId(user.userId)) ??
      (await this.users.ensurePersistedFromClerk(user.userId));
    return this.settings.setGroceries(body, admin.id, reqId(req));
  }

  @Get('admin/settings/fridge-alert')
  @ApiTags(TAGS.adminBookings)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Read the fridge alert threshold',
    description:
      'Recettes lot 3 (LF-0271): past this many days in the fridge, a dish’s « à ' +
      'manger avant » date shows an alert, never a block. 4 by default (BLK-31: to ' +
      'confirm with the hygiene referent). `updatedAt: null`: never changed.',
  })
  @ApiOkResponse({
    description: 'The threshold.',
    example: { days: 4, updatedAt: null },
  })
  @ApiAdminAuthResponses()
  fridgeAlert() {
    return this.settings.fridgeAlert();
  }

  @Put('admin/settings/fridge-alert')
  @ApiTags(TAGS.adminBookings)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Change the fridge alert threshold',
    description:
      'From 1 to 14 days. Every view reads it from now on. Recorded in the audit log.',
  })
  @ApiOkResponse({
    description: 'The new threshold.',
    example: { days: 5, updatedAt: '2026-11-14T09:00:00.000Z' },
  })
  @ApiAdminAuthResponses()
  async setFridgeAlert(
    @CurrentClerkUser() user: ClerkUser,
    @Body() body: FridgeAlertDto,
    @Req() req: { id?: unknown },
  ) {
    const admin =
      (await this.users.findByClerkId(user.userId)) ??
      (await this.users.ensurePersistedFromClerk(user.userId));
    return this.settings.setFridgeAlert(body.days, admin.id, reqId(req));
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

  @Get('referentials/aisles')
  @ApiTags(TAGS.referentials)
  @ApiOperation({
    summary: 'List the shop aisles',
    description:
      'What an ingredient of the common list takes as its aisle (Recettes §5.4), in ' +
      'store order: the shopping list groups by it. The list is edited in the ' +
      'console. Public.',
  })
  @ApiOkResponse({ description: 'The aisles, in store order.', example: AISLES_EXAMPLE })
  aisles() {
    return this.settings.aisles();
  }

  @Get('admin/settings/aisles')
  @ApiTags(TAGS.adminContent)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Read the shop aisles',
    description: '`updatedAt: null`: never changed, the 13 default aisles apply.',
  })
  @ApiOkResponse({ description: 'The aisles.', example: AISLES_EXAMPLE })
  @ApiAdminAuthResponses()
  adminAisles() {
    return this.settings.aisles();
  }

  @Put('admin/settings/aisles')
  @ApiTags(TAGS.adminContent)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Change the shop aisles',
    description:
      'The whole list in store order, every time, each code once (else 422 ' +
      '`VALIDATION_FAILED`). An ingredient keeps a code removed from the list. ' +
      'Recorded in the audit log.',
  })
  @ApiOkResponse({ description: 'The new list.', example: AISLES_EXAMPLE })
  @ApiAdminAuthResponses()
  async setAisles(
    @CurrentClerkUser() user: ClerkUser,
    @Body() body: AislesDto,
    @Req() req: { id?: unknown },
  ) {
    const admin =
      (await this.users.findByClerkId(user.userId)) ??
      (await this.users.ensurePersistedFromClerk(user.userId));
    return this.settings.setAisles(body.aisles, admin.id, reqId(req));
  }
}
