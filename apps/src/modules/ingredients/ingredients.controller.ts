import {
  Body,
  Controller,
  Get,
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
  createdAt: '2026-11-02T09:00:00.000Z',
  updatedAt: '2026-11-02T09:00:00.000Z',
};

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
    description: 'By name, paginated; `search` filters on a name or another name.',
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

  /** The admin's Postgres id: the audit log records a person. */
  private async adminId(user: ClerkUser) {
    const admin =
      (await this.users.findByClerkId(user.userId)) ??
      (await this.users.ensurePersistedFromClerk(user.userId));
    return admin.id;
  }
}
