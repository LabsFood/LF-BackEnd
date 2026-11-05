import {
  Body,
  Controller,
  Get,
  HttpCode,
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
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiUnprocessableEntityResponse,
  ApiTags,
} from '@nestjs/swagger';

import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import {
  ApiAdminAuthResponses,
  ApiClerkAuthResponses,
} from '../../common/swagger/auth-responses';
import { TAGS } from '../../common/swagger/tags';
import { ChefContentService } from '../dishes/chef-content.service';
import { UsersService } from '../users/users.service';
import {
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
  aisle: 'fruits-legumes',
  allergens: [],
  allergensNone: true,
  isBasic: false,
  status: 'active',
  private: false,
  reviewedAt: null,
  createdAt: '2026-11-02T09:00:00.000Z',
  updatedAt: '2026-11-02T09:00:00.000Z',
};

@Controller()
export class IngredientsController {
  constructor(
    private readonly ingredients: IngredientsService,
    private readonly users: UsersService,
    private readonly chefs: ChefContentService,
  ) {}

  @Get('ingredients')
  @ApiTags(TAGS.chefContent)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard)
  @ApiOperation({
    summary: 'Search the common ingredient list',
    description:
      'Recettes §4.10: up to 20 ingredients whose name contains `search` (accents ' +
      'ignored), or whose other name is exactly `search`. The common active entries, ' +
      'plus the caller’s own pending ones (`private: true`); never another chef’s. ' +
      'Each carries its aisle, allergens, `allergensNone`, `isBasic` and `status`. A ' +
      'recipe line links one with `catalogIngredientId`.',
  })
  @ApiOkResponse({ description: 'The matches, by name.', example: [INGREDIENT_EXAMPLE] })
  @ApiClerkAuthResponses()
  async search(
    @CurrentClerkUser() user: ClerkUser,
    @Query() query: SearchIngredientsQueryDto,
  ) {
    // Recettes §4.10: an admin or a client has no chef profile (no throw): common entries only.
    const chefProfileId = await this.chefs.chefProfileIdOf(user.userId);
    return this.ingredients.search(query.search, chefProfileId);
  }

  @Get('admin/ingredients')
  @ApiTags(TAGS.adminCatalog)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'List the common ingredient list',
    description:
      'Recettes §5.1: every entry, private ones included, by name, paginated. `search` ' +
      'filters on a name or another name; `status`, `aisle`, `incomplete=true` (no aisle, ' +
      'or allergens neither listed nor "none") and `reviewed=true|false` narrow it.',
  })
  @ApiOkResponse({
    description: '`{ data, meta }`.',
    example: { data: [INGREDIENT_EXAMPLE], meta: { page: 1, limit: 20, total: 1 } },
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
      'Name, up to 20 other names, the diets it suits (implied ones are added), months ' +
      'in season, aisle (a code of the list in force), allergens or `allergensNone`, and ' +
      '`isBasic`. `422` for an unknown aisle, or allergens together with ' +
      '`allergensNone`. `409 INGREDIENT_ALREADY_LISTED` (with the existing `{ id, name }`) ' +
      'when the name exists, whatever the case or accents. Recorded in the audit log.',
  })
  @ApiCreatedResponse({ description: 'The ingredient.', example: INGREDIENT_EXAMPLE })
  @ApiConflictResponse({
    description: 'The name is already in the list.',
    example: {
      code: 'INGREDIENT_ALREADY_LISTED',
      message: 'An ingredient of this name is already in the list.',
      ingredient: { id: INGREDIENT_EXAMPLE.id, name: 'Tomate' },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Unknown aisle, or allergens together with `allergensNone`.',
  })
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
      'Only the fields sent change. `status` is `active` or `inactive`, for a common ' +
      'entry only (`422` on a chef’s private one). The dishes that link it are ' +
      'classified again. Recorded in the audit log.',
  })
  @ApiOkResponse({ description: 'The ingredient.', example: INGREDIENT_EXAMPLE })
  @ApiNotFoundResponse({ description: 'No such ingredient.' })
  @ApiConflictResponse({ description: 'The new name is already in the list.' })
  @ApiUnprocessableEntityResponse({
    description:
      'Unknown aisle, allergens together with `allergensNone`, or a status on a private entry.',
  })
  @ApiAdminAuthResponses()
  async update(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCatalogIngredientDto,
  ) {
    return this.ingredients.update(id, body, await this.adminId(user));
  }

  @Post('admin/ingredients/:id/review')
  @HttpCode(200)
  @ApiTags(TAGS.adminCatalog)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Mark an ingredient as reviewed',
    description:
      'Recettes §5.1: the admin has checked its aisle and allergens. Sets `reviewedAt` ' +
      'and the reviewer. Recorded in the audit log.',
  })
  @ApiOkResponse({ description: 'The ingredient.', example: INGREDIENT_EXAMPLE })
  @ApiNotFoundResponse({ description: 'No such ingredient.' })
  @ApiAdminAuthResponses()
  async review(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ingredients.review(id, await this.adminId(user));
  }

  /** The admin's Postgres id: the audit log records a person. */
  private async adminId(user: ClerkUser) {
    const admin =
      (await this.users.findByClerkId(user.userId)) ??
      (await this.users.ensurePersistedFromClerk(user.userId));
    return admin.id;
  }
}
