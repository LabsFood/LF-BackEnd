import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { ApiAdminAuthResponses } from '../../common/swagger/auth-responses';
import { TAGS } from '../../common/swagger/tags';
import { UsersService } from '../users/users.service';
import { ContentQueryDto, ModerationDto, ReviewDto } from './dto/moderation.dto';
import { ModerationService } from './moderation.service';
import { DISH_EXAMPLE, DISH_ID, MENU_EXAMPLE, MENU_ID } from './swagger-examples';

const CHEF = { id: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', displayName: 'Marie Dupont' };

const QUEUE_EXAMPLE = {
  data: [
    {
      type: 'dish',
      id: DISH_ID,
      name: 'Poulet rôti aux herbes',
      chef: CHEF,
      status: 'published',
      publishedAt: '2026-09-20T14:02:11.000Z',
      reviewState: 'never-reviewed',
      pendingSince: '2026-09-20T14:02:11.000Z',
      reviewedAt: null,
      flags: ['custom-allergen'],
      customAllergens: ['sarrasin'],
      customDiets: [],
    },
  ],
  meta: {
    page: 1,
    limit: 20,
    total: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
};

const ADMIN_DISH = {
  ...DISH_EXAMPLE,
  chefProfileId: CHEF.id,
  review: {
    reviewedAt: null,
    pendingSince: '2026-09-20T14:02:11.000Z',
    reason: 'never-reviewed',
  },
};

const SUSPENDED_DISH = {
  ...ADMIN_DISH,
  status: 'suspended',
  moderation: {
    reason:
      'Les allergènes ne mentionnent pas le lait, alors que la recette contient du beurre.',
    reasonCode: 'allergens-incomplete',
    at: '2026-09-21T09:30:00.000Z',
  },
  review: { reviewedAt: '2026-09-21T09:30:00.000Z', pendingSince: null, reason: null },
};

const REASON_REQUIRED = {
  description: '`REASON_REQUIRED`: the reason is missing, or not 15 to 500 characters.',
  example: {
    code: 'REASON_REQUIRED',
    message:
      'Give a reason of 15 to 500 characters: the batch cooker reads it as written.',
  },
};

const MODERATION_DESCRIPTION =
  '`{ "status": "suspended", "reason": "…", "reasonCode": "allergens-incomplete" }` ' +
  'takes it off the public site at once, emails the batch cooker (unless ' +
  '`notifyChef: false`) and is recorded. The reason is shown to them as written. ' +
  'Bookings already made are not changed.\n\n' +
  '`{ "status": "published", "reason": "…" }` lifts a suspension. The batch cooker can ' +
  'also lift it by correcting and republishing, which puts it back first in the queue.';

/**
 * Moderation after the fact (FLOW-02 §4): the review queue, one-click review,
 * taking content down, and what admins see of a batch cooker's dishes and menus.
 */
@ApiBearerAuth()
@Controller('admin')
@UseGuards(ClerkAuthGuard, AdminGuard)
export class AdminModerationController {
  constructor(
    private readonly moderation: ModerationService,
    private readonly users: UsersService,
  ) {}

  /** The admin's Postgres uuid: the audit records a person. */
  private async adminId(user: ClerkUser): Promise<string> {
    const row = await this.users.findByClerkId(user.userId);
    return row!.id;
  }

  @Get('dishes')
  @ApiTags(TAGS.adminContent)
  @ApiOperation({
    summary: 'Review queue, and batch cookers’ dishes',
    description:
      'With `?review=pending`: the review queue, dishes and menus that are public and ' +
      'that nobody has looked at since they were published, edited on allergens, ' +
      'diets or country, republished after a suspension, or adopted from a suggestion ' +
      'that changed. A republication comes first, then the longest wait.\n\n' +
      '`flags` point at what deserves a look: `custom-allergen`, `custom-diet`, ' +
      '`no-allergens-declared`, `edited-after-review`, `republished-after-suspension`, ' +
      '`source-changed`.\n\n' +
      'Without `review`: batch cookers’ dishes, most recently changed first. Filter ' +
      'with `chefId` and `type`.',
  })
  @ApiOkResponse({ description: 'One page of items.', example: QUEUE_EXAMPLE })
  @ApiAdminAuthResponses()
  list(@Query() query: ContentQueryDto) {
    return this.moderation.list(query);
  }

  @Get('dishes/custom-values')
  @ApiTags(TAGS.adminContent)
  @ApiOperation({
    summary: 'See the free-text diets and allergens batch cookers type',
    description:
      'Values typed with "Autre", counted whatever their case or accents, most ' +
      'frequent first. One that keeps coming back belongs in the reference list.',
  })
  @ApiOkResponse({
    description: 'The values and how often they appear.',
    example: {
      diets: [{ value: 'Pescétarien', count: 4 }],
      allergens: [{ value: 'Sarrasin', count: 7 }],
    },
  })
  @ApiAdminAuthResponses()
  customValues() {
    return this.moderation.customValues();
  }

  @Post('dishes/:id/review')
  @ApiTags(TAGS.adminContent)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark a dish reviewed',
    description:
      'Takes it out of the queue; nothing changes for the batch cooker. Body: ' +
      '`{ "outcome": "ok", "note": "…" }`, the note for other admins only.',
  })
  @ApiParam({ name: 'id', description: 'The dish id.', example: DISH_ID })
  @ApiOkResponse({
    description: 'Reviewed.',
    example: { type: 'dish', id: DISH_ID, reviewedAt: '2026-09-21T09:30:00.000Z' },
  })
  @ApiNotFoundResponse({ description: 'No batch cooker dish with this id.' })
  @ApiAdminAuthResponses()
  async reviewDish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() payload: ReviewDto,
    @CurrentClerkUser() user: ClerkUser,
  ) {
    return this.moderation.review('dish', id, await this.adminId(user), payload);
  }

  @Patch('dishes/:id/moderation')
  @ApiTags(TAGS.adminContent)
  @ApiOperation({
    summary: 'Take a dish down, or lift that',
    description: MODERATION_DESCRIPTION,
  })
  @ApiParam({ name: 'id', description: 'The dish id.', example: DISH_ID })
  @ApiOkResponse({ description: 'The dish as admins see it.', example: SUSPENDED_DISH })
  @ApiUnprocessableEntityResponse(REASON_REQUIRED)
  @ApiConflictResponse({
    description:
      '`INVALID_TRANSITION`: only published content can be taken down, only suspended ' +
      'content reinstated.',
  })
  @ApiNotFoundResponse({ description: 'No batch cooker dish with this id.' })
  @ApiAdminAuthResponses()
  async moderateDish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() payload: ModerationDto,
    @CurrentClerkUser() user: ClerkUser,
  ) {
    return this.moderation.moderate('dish', id, await this.adminId(user), payload);
  }

  @Post('menus/:id/review')
  @ApiTags(TAGS.adminContent)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark a menu reviewed',
    description: 'As for a dish.',
  })
  @ApiParam({ name: 'id', description: 'The menu id.', example: MENU_ID })
  @ApiOkResponse({
    description: 'Reviewed.',
    example: { type: 'menu', id: MENU_ID, reviewedAt: '2026-09-21T09:30:00.000Z' },
  })
  @ApiNotFoundResponse({ description: 'No batch cooker menu with this id.' })
  @ApiAdminAuthResponses()
  async reviewMenu(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() payload: ReviewDto,
    @CurrentClerkUser() user: ClerkUser,
  ) {
    return this.moderation.review('menu', id, await this.adminId(user), payload);
  }

  @Patch('menus/:id/moderation')
  @ApiTags(TAGS.adminContent)
  @ApiOperation({
    summary: 'Take a menu down, or lift that',
    description: MODERATION_DESCRIPTION,
  })
  @ApiParam({ name: 'id', description: 'The menu id.', example: MENU_ID })
  @ApiOkResponse({
    description: 'The menu as admins see it.',
    example: { ...MENU_EXAMPLE, status: 'suspended', chefProfileId: CHEF.id },
  })
  @ApiUnprocessableEntityResponse(REASON_REQUIRED)
  @ApiConflictResponse({ description: '`INVALID_TRANSITION`.' })
  @ApiNotFoundResponse({ description: 'No batch cooker menu with this id.' })
  @ApiAdminAuthResponses()
  async moderateMenu(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() payload: ModerationDto,
    @CurrentClerkUser() user: ClerkUser,
  ) {
    return this.moderation.moderate('menu', id, await this.adminId(user), payload);
  }

  @Get('chefs/:id/dishes')
  @ApiTags(TAGS.adminContent)
  @ApiOperation({
    summary: 'See a batch cooker’s dishes',
    description:
      'Every dish, drafts and suspended ones included, with the full recipe, which ' +
      'admins may read (§8), and where each stands in review.',
  })
  @ApiParam({ name: 'id', description: 'The batch cooker id (chef profile).' })
  @ApiOkResponse({ description: 'The dishes.', example: [ADMIN_DISH] })
  @ApiNotFoundResponse({ description: 'No batch cooker with this id.' })
  @ApiAdminAuthResponses()
  chefDishes(@Param('id', ParseUUIDPipe) id: string) {
    return this.moderation.chefDishes(id);
  }

  @Get('chefs/:id/menus')
  @ApiTags(TAGS.adminContent)
  @ApiOperation({
    summary: 'See a batch cooker’s menus',
    description: 'Every menu, with its dishes and where it stands in review.',
  })
  @ApiParam({ name: 'id', description: 'The batch cooker id (chef profile).' })
  @ApiOkResponse({
    description: 'The menus.',
    example: [{ ...MENU_EXAMPLE, chefProfileId: CHEF.id }],
  })
  @ApiNotFoundResponse({ description: 'No batch cooker with this id.' })
  @ApiAdminAuthResponses()
  chefMenus(@Param('id', ParseUUIDPipe) id: string) {
    return this.moderation.chefMenus(id);
  }
}
