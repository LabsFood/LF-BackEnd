import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import {
  ApiAdminAuthResponses,
  ApiClerkAuthResponses,
} from '../../common/swagger/auth-responses';
import { TAGS } from '../../common/swagger/tags';
import { UsersService } from '../users/users.service';
import {
  AdoptIngredientDto,
  CatalogIngredientDto,
  ListCatalogIngredientsQueryDto,
  SearchIngredientsQueryDto,
  UpdateCatalogIngredientDto,
} from './dto/ingredient.dto';
import { IngredientsService } from './ingredients.service';

const INGREDIENT_EXAMPLE = {
  id: '0d7c1c7a-3f5b-4d8e-9a1c-2b4e6f8a0c11',
  name: 'Tomate',
  aliases: ['pomme d’amour'],
  diets: ['vegetarian', 'vegan', 'no-pork', 'pescetarian', 'gluten-free', 'lactose-free'],
  seasonMonths: [6, 7, 8, 9],
  createdAt: '2026-11-02T09:00:00.000Z',
  updatedAt: '2026-11-02T09:00:00.000Z',
};

const SEASON_REVIEW_EXAMPLE = {
  season: 'autumn',
  seasonStartsAt: '2026-08-31T22:00:00.000Z',
  reviewedAt: null,
  due: true,
  reason: 'never_reviewed',
};

const CHEF_INGREDIENT_EXAMPLE = {
  id: '5b2e8f1a-9c3d-4e7f-8a6b-1c2d3e4f5a6b',
  chefProfileId: '7f3c2a1b-4d5e-4f6a-9b8c-0d1e2f3a4b5c',
  catalogIngredientId: INGREDIENT_EXAMPLE.id,
  name: 'Tomate cœur de bœuf',
  aliases: [],
  diets: ['vegetarian', 'vegan'],
  seasonMonths: [7, 8],
  createdAt: '2026-11-10T09:00:00.000Z',
  updatedAt: '2026-11-10T09:00:00.000Z',
};

const reqId = (req: { id?: unknown }): string | undefined =>
  typeof req.id === 'string' ? req.id : undefined;

@Controller()
export class IngredientsController {
  constructor(
    private readonly ingredients: IngredientsService,
    private readonly users: UsersService,
  ) {}

  @Get('ingredients')
  @ApiTags(TAGS.chefContent)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard)
  @ApiOperation({
    summary: 'Search the common ingredient list',
    description:
      'Recettes §4.10: up to 20 ingredients whose name contains `search`, or whose ' +
      'other name is exactly `search`. A recipe line links one with ' +
      '`catalogIngredientId`; the dish’s diets and seasons are computed from them.',
  })
  @ApiOkResponse({ description: 'The matches, by name.', example: [INGREDIENT_EXAMPLE] })
  @ApiClerkAuthResponses()
  search(@Query() query: SearchIngredientsQueryDto) {
    return this.ingredients.search(query.search);
  }

  @Get('admin/ingredients')
  @ApiTags(TAGS.adminCatalog)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'List the common ingredient list',
    description:
      'By name, paginated; `search` filters on a name or another name. `seasonReview` ' +
      'says whether to remind the admin (BLK-33): `due` with `reason` `empty` (build ' +
      'the first list), `never_reviewed`, or `new_season` (a season started on 1 March, ' +
      'June, September or December, Paris time, since the last ' +
      '`POST /admin/ingredients/season-review`).',
  })
  @ApiOkResponse({
    description: '`{ data, meta, seasonReview }`.',
    example: {
      data: [INGREDIENT_EXAMPLE],
      meta: { page: 1, limit: 20, total: 1 },
      seasonReview: SEASON_REVIEW_EXAMPLE,
    },
  })
  @ApiAdminAuthResponses()
  list(@Query() query: ListCatalogIngredientsQueryDto) {
    return this.ingredients.list(query);
  }

  @Post('admin/ingredients')
  @ApiTags(TAGS.adminCatalog)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Add an ingredient to the common list',
    description:
      'Name, other names, the diets it suits and its months in season. `409 ' +
      'INGREDIENT_ALREADY_LISTED` when the name exists, whatever the case. Recorded in ' +
      'the audit log.',
  })
  @ApiCreatedResponse({ description: 'The ingredient.', example: INGREDIENT_EXAMPLE })
  @ApiConflictResponse({ description: 'The name is already in the list.' })
  @ApiAdminAuthResponses()
  async create(@CurrentClerkUser() user: ClerkUser, @Body() body: CatalogIngredientDto) {
    return this.ingredients.create(body, await this.adminId(user));
  }

  @Patch('admin/ingredients/:id')
  @ApiTags(TAGS.adminCatalog)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Change an ingredient of the common list',
    description:
      'Only the fields sent change. The dishes that link it are classified again. ' +
      'Recorded in the audit log.',
  })
  @ApiOkResponse({ description: 'The ingredient.', example: INGREDIENT_EXAMPLE })
  @ApiNotFoundResponse({ description: 'No such ingredient.' })
  @ApiConflictResponse({ description: 'The new name is already in the list.' })
  @ApiAdminAuthResponses()
  async update(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCatalogIngredientDto,
  ) {
    return this.ingredients.update(id, body, await this.adminId(user));
  }

  @Post('admin/ingredients/season-review')
  @HttpCode(200)
  @ApiTags(TAGS.adminCatalog)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Confirm the ingredient list fits the season',
    description:
      'BLK-33: clears the season reminder until the next season starts. Changing ' +
      'entries does not clear it by itself. Recorded in the audit log.',
  })
  @ApiOkResponse({
    description: 'The reminder, now off.',
    example: {
      ...SEASON_REVIEW_EXAMPLE,
      reviewedAt: '2026-11-10T09:00:00.000Z',
      due: false,
      reason: null,
    },
  })
  @ApiAdminAuthResponses()
  async seasonReviewed(
    @CurrentClerkUser() user: ClerkUser,
    @Req() req: { id?: unknown },
  ) {
    return this.ingredients.markSeasonReviewed(await this.adminId(user), reqId(req));
  }

  @Get('me/chef/ingredients')
  @ApiTags(TAGS.chefContent)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard)
  @ApiOperation({
    summary: 'List my own ingredients',
    description:
      'BLK-33: the entries of the common list I adopted, in my version, by name (500 ' +
      'at most). My dishes are classified from these; the rest from the common list. ' +
      '`NOT_A_CHEF`, `CHEF_NOT_VERIFIED`.',
  })
  @ApiOkResponse({ description: 'My versions.', example: [CHEF_INGREDIENT_EXAMPLE] })
  @ApiClerkAuthResponses()
  async listMine(@CurrentClerkUser() user: ClerkUser) {
    const chef = await this.users.chefIdentity(user.userId);
    return this.ingredients.listMine(chef.chefProfileId);
  }

  @Post('me/chef/ingredients')
  @ApiTags(TAGS.chefContent)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard)
  @ApiOperation({
    summary: 'Adopt an ingredient of the common list',
    description:
      'Copies the entry into my list, to edit with `PATCH /me/chef/ingredients/{id}`. ' +
      'Adopting it again returns my version unchanged. `404 INGREDIENT_NOT_FOUND`, ' +
      '`422 CHEF_INGREDIENTS_LIMIT` past 500.',
  })
  @ApiCreatedResponse({ description: 'My version.', example: CHEF_INGREDIENT_EXAMPLE })
  @ApiNotFoundResponse({ description: 'No such entry in the common list.' })
  @ApiUnprocessableEntityResponse({ description: 'Already 500 ingredients of my own.' })
  @ApiClerkAuthResponses()
  async adopt(@CurrentClerkUser() user: ClerkUser, @Body() body: AdoptIngredientDto) {
    const chef = await this.users.chefIdentity(user.userId);
    return this.ingredients.adopt(chef.chefProfileId, body.catalogIngredientId);
  }

  @Patch('me/chef/ingredients/:id')
  @ApiTags(TAGS.chefContent)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard)
  @ApiOperation({
    summary: 'Edit my version of an ingredient',
    description:
      'Only the fields sent change. My dishes that link it are classified again from ' +
      'my version. `404 CHEF_INGREDIENT_NOT_FOUND` for an id not in my list.',
  })
  @ApiOkResponse({ description: 'My version.', example: CHEF_INGREDIENT_EXAMPLE })
  @ApiNotFoundResponse({ description: 'Not in my list.' })
  @ApiClerkAuthResponses()
  async updateMine(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCatalogIngredientDto,
  ) {
    const chef = await this.users.chefIdentity(user.userId);
    return this.ingredients.updateMine(chef.chefProfileId, id, body);
  }

  @Delete('me/chef/ingredients/:id')
  @HttpCode(204)
  @ApiTags(TAGS.chefContent)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard)
  @ApiOperation({
    summary: 'Go back to the common version of an ingredient',
    description:
      'Removes my version: my dishes that link it are classified from the common list ' +
      'again. `404 CHEF_INGREDIENT_NOT_FOUND`.',
  })
  @ApiNoContentResponse({ description: 'Removed.' })
  @ApiNotFoundResponse({ description: 'Not in my list.' })
  @ApiClerkAuthResponses()
  async removeMine(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    const chef = await this.users.chefIdentity(user.userId);
    await this.ingredients.removeMine(chef.chefProfileId, id);
  }

  /** The admin's Postgres id: the audit log records a person. */
  private async adminId(user: ClerkUser) {
    const admin =
      (await this.users.findByClerkId(user.userId)) ??
      (await this.users.ensurePersistedFromClerk(user.userId));
    return admin.id;
  }
}
