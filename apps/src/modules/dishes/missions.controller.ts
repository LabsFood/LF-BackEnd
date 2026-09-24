import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { ApiClerkAuthResponses } from '../../common/swagger/auth-responses';
import { TAGS } from '../../common/swagger/tags';
import { PutShoppingListDto, RecipeSheetQueryDto } from './dto/mission.dto';
import { MissionsService } from './missions.service';
import { DISH_ID, RECIPE_EXAMPLE } from './swagger-examples';

const MISSION_ID = '7b1ebc99-9c0b-4ef8-bb6d-6bb9bd380a88';

const SHOPPING_LIST_EXAMPLE = {
  missionId: MISSION_ID,
  persons: 3,
  generatedAt: '2026-09-20T15:41:02.000Z',
  groups: [
    {
      aisle: 'fruits-legumes',
      lines: [
        { name: 'Ail', qty: 6, unit: 'gousse', edited: true },
        { name: 'Pommes de terre grenaille', qty: 800, unit: 'g', edited: false },
      ],
    },
    {
      aisle: 'boucherie',
      lines: [{ name: 'Poulet fermier entier', qty: 1.4, unit: 'kg', edited: false }],
    },
  ],
};

const NOT_FOUND = {
  description:
    'No such prestation for you (only its batch cooker, admins and its client).',
};

const CHEF_ONLY = {
  description:
    '`CONTENT_NOT_OWNED`: only the batch cooker of this prestation can change it.',
};

const ApiMissionIdParam = () =>
  ApiParam({
    name: 'id',
    description: 'The prestation (booking) id.',
    example: MISSION_ID,
  });

/**
 * A prestation's documents (FLOW-02 §7): the fiche recette and the shopping list,
 * both from the recipe versions the prestation cooks from. Plus the client's
 * culinary map (§5.3).
 */
@ApiBearerAuth()
@Controller()
@UseGuards(ClerkAuthGuard)
export class MissionsController {
  constructor(private readonly missions: MissionsService) {}

  @Get('chef-missions/:id/dishes/:dishId/recipe-sheet')
  @ApiTags(TAGS.missions)
  @ApiOperation({
    summary: 'Get the recipe sheet of a dish of a prestation',
    description:
      'The standard fiche: dish, allergens, ingredients **scaled** to `portions` (by ' +
      'default those booked), steps, reheating, storage. The page renders it.\n\n' +
      'It shows the recipe version the prestation cooks from. When the batch cooker ' +
      'has changed the recipe since, `version.newerAvailable` is `true`, with both ' +
      'version numbers.\n\n' +
      'The batch cooker and admins read it at any time; the client once the ' +
      'prestation is done (`403 NOT_YET_AVAILABLE` before).',
  })
  @ApiMissionIdParam()
  @ApiParam({
    name: 'dishId',
    description: 'A dish of the prestation.',
    example: DISH_ID,
  })
  @ApiOkResponse({
    description: 'The fiche.',
    example: {
      missionId: MISSION_ID,
      dish: {
        id: DISH_ID,
        name: 'Poulet rôti aux herbes',
        country: 'FR',
        category: 'main',
        diets: ['lactose-free'],
        customDiets: [],
        allergens: ['celery'],
        allergensNone: false,
        customAllergens: [],
      },
      portions: 4,
      recipe: RECIPE_EXAMPLE,
      version: { pinned: 2, current: 3, newerAvailable: true },
    },
  })
  @ApiForbiddenResponse({
    description: '`NOT_YET_AVAILABLE`: for the client, before the prestation.',
  })
  @ApiNotFoundResponse(NOT_FOUND)
  @ApiClerkAuthResponses()
  recipeSheet(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dishId', ParseUUIDPipe) dishId: string,
    @Query() query: RecipeSheetQueryDto,
  ) {
    return this.missions.recipeSheet(user.userId, id, dishId, query.portions);
  }

  @Get('chef-missions/:id/shopping-list')
  @ApiTags(TAGS.missions)
  @ApiOperation({
    summary: 'Get the shopping list of a prestation',
    description:
      'Computed from the recipes of the prestation: scaled to the portions booked, ' +
      'the same ingredient in the same unit added up, grouped by aisle. `edited: true` ' +
      'marks a line the batch cooker changed or added. For the batch cooker, admins ' +
      'and the client.',
  })
  @ApiMissionIdParam()
  @ApiOkResponse({ description: 'The list.', example: SHOPPING_LIST_EXAMPLE })
  @ApiNotFoundResponse(NOT_FOUND)
  @ApiClerkAuthResponses()
  shoppingList(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.missions.shoppingList(user.userId, id);
  }

  @Put('chef-missions/:id/shopping-list')
  @ApiTags(TAGS.missions)
  @ApiOperation({
    summary: 'Correct the shopping list of a prestation',
    description:
      'Send the whole list as you want it. What differs from the recipes is kept as ' +
      'your correction and **survives every recalculation**; a computed line you ' +
      'leave out is struck out. `POST …/shopping-list/reset` drops every correction.',
  })
  @ApiMissionIdParam()
  @ApiOkResponse({ description: 'The corrected list.', example: SHOPPING_LIST_EXAMPLE })
  @ApiForbiddenResponse(CHEF_ONLY)
  @ApiNotFoundResponse(NOT_FOUND)
  @ApiClerkAuthResponses()
  correct(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() payload: PutShoppingListDto,
  ) {
    return this.missions.correctShoppingList(user.userId, id, payload.lines);
  }

  @Post('chef-missions/:id/shopping-list/reset')
  @ApiTags(TAGS.missions)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Go back to the computed shopping list',
    description: 'Drops every correction: the list is again the one the recipes give.',
  })
  @ApiMissionIdParam()
  @ApiOkResponse({ description: 'The computed list.', example: SHOPPING_LIST_EXAMPLE })
  @ApiForbiddenResponse(CHEF_ONLY)
  @ApiNotFoundResponse(NOT_FOUND)
  @ApiClerkAuthResponses()
  reset(@CurrentClerkUser() user: ClerkUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.missions.resetShoppingList(user.userId, id);
  }

  @Post('chef-missions/:id/recipes/repin')
  @ApiTags(TAGS.missions)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Move a prestation to my current recipes',
    description:
      'A prestation cooks from the recipe versions of when it was booked. Before it ' +
      'starts, you may move it to your current recipes: deliberately, recorded, and ' +
      'the shopping list is recomputed (your corrections stay). Refused once it has ' +
      'started.',
  })
  @ApiMissionIdParam()
  @ApiOkResponse({ description: 'The recomputed list.', example: SHOPPING_LIST_EXAMPLE })
  @ApiConflictResponse({ description: '`PRESTATION_STARTED`.' })
  @ApiForbiddenResponse(CHEF_ONLY)
  @ApiNotFoundResponse(NOT_FOUND)
  @ApiClerkAuthResponses()
  repin(@CurrentClerkUser() user: ClerkUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.missions.repin(user.userId, id);
  }

  @Get('me/culinary-map')
  @ApiTags(TAGS.dashboards)
  @ApiOperation({
    summary: 'See the countries I have tasted',
    description:
      'Every country one of my delivered prestations served a dish from, for the ' +
      'world map: `iso3166Numeric` is the key the map uses, `code` the ISO letters. ' +
      'Cancelled or upcoming prestations colour nothing. `total` is the number of ' +
      'countries on the map.',
  })
  @ApiOkResponse({
    description: 'The map.',
    example: {
      total: 195,
      explored: [
        {
          code: 'FR',
          iso3166Numeric: '250',
          name: 'France',
          firstTastedAt: '2026-05-24T09:00:00.000Z',
          dishes: ['Poulet rôti aux herbes', 'Bœuf bourguignon'],
        },
      ],
    },
  })
  @ApiClerkAuthResponses()
  culinaryMap(@CurrentClerkUser() user: ClerkUser) {
    return this.missions.culinaryMap(user.userId);
  }
}
