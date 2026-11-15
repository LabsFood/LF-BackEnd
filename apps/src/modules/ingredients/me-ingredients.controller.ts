import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { ApiClerkAuthResponses } from '../../common/swagger/auth-responses';
import { TAGS } from '../../common/swagger/tags';
import { ChefIngredientsService } from './chef-ingredients.service';
import { ChefIngredientDto, UpdateChefIngredientDto } from './dto/chef-ingredient.dto';

const PRIVATE_INGREDIENT_EXAMPLE = {
  id: '5b1d2c3e-7a49-4f60-8c1e-9d0a3b4c5d6e',
  name: 'Harissa maison',
  aliases: [],
  diets: [],
  seasonMonths: [],
  aisle: 'epices',
  allergens: ['mustard'],
  allergensNone: false,
  isBasic: false,
  status: 'pending',
  mergedInto: null,
  reviewedAt: null,
  createdAt: '2026-11-04T09:00:00.000Z',
  updatedAt: '2026-11-04T09:00:00.000Z',
};

const NOT_VERIFIED = {
  description:
    '`CHEF_NOT_VERIFIED`: the candidature is not approved yet. Until then a batch ' +
    'cooker can read but not write.',
};

/**
 * Recettes §7.1: the ingredients the signed-in batch cooker added to the list. Reads
 * work for everyone with a chef profile; writes need an approved candidature, as
 * for dishes.
 */
@ApiBearerAuth()
@Controller('me/ingredients')
@UseGuards(ClerkAuthGuard)
export class MeIngredientsController {
  constructor(private readonly ingredients: ChefIngredientsService) {}

  @Post()
  @ApiTags(TAGS.chefContent)
  @ApiOperation({
    summary: 'Add an ingredient the common list lacks',
    description:
      'Recettes §7.1: name, aisle (a code of the list in force) and the allergens, or ' +
      '`allergensNone: true` (neither: `400`). Optionally other names, diets, months ' +
      'in season and `isBasic`. The ingredient is `pending` and private: only this ' +
      'batch cooker finds it in `GET /ingredients` and links it, right away, until ' +
      "Lab's Food validates it (it becomes common), merges it into a common one or " +
      'corrects it. `409 INGREDIENT_ALREADY_LISTED` (with the existing `{ id, name }`) ' +
      'when the name is a name or another name of a common ingredient, or one of this ' +
      "batch cooker's pending ingredients: link that one instead. `429 " +
      'INGREDIENT_CAP_REACHED` after 50 creations over 24 hours.',
  })
  @ApiCreatedResponse({
    description: 'The pending ingredient.',
    example: PRIVATE_INGREDIENT_EXAMPLE,
  })
  @ApiConflictResponse({
    description: 'The name is already listed.',
    example: {
      code: 'INGREDIENT_ALREADY_LISTED',
      message: 'An ingredient of this name is already in the list.',
      ingredient: { id: '0d7c1c7a-3f5b-4d8e-9a1c-2b4e6f8a0c11', name: 'Harissa' },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Unknown aisle, or allergens together with `allergensNone`.',
  })
  @ApiTooManyRequestsResponse({
    description: '`INGREDIENT_CAP_REACHED`: 50 creations over the last 24 hours.',
    example: {
      code: 'INGREDIENT_CAP_REACHED',
      message: 'Too many ingredients created: try again later.',
    },
  })
  @ApiForbiddenResponse(NOT_VERIFIED)
  @ApiNotFoundResponse({ description: 'This account has no batch cooker profile.' })
  @ApiClerkAuthResponses()
  create(@CurrentClerkUser() user: ClerkUser, @Body() payload: ChefIngredientDto) {
    return this.ingredients.create(user.userId, payload);
  }

  @Get()
  @ApiTags(TAGS.chefContent)
  @ApiOperation({
    summary: 'List the ingredients I added',
    description:
      'Recettes §7.1: every ingredient this batch cooker created, newest first, ' +
      'whatever its `status`: `pending`, `active` (validated: common now), `inactive` ' +
      'or `merged`, which names its target in `mergedInto` (`{ id, name }`). Not ' +
      'paginated.',
  })
  @ApiOkResponse({
    description: 'The ingredients.',
    example: [PRIVATE_INGREDIENT_EXAMPLE],
  })
  @ApiNotFoundResponse({ description: 'This account has no batch cooker profile.' })
  @ApiClerkAuthResponses()
  list(@CurrentClerkUser() user: ClerkUser) {
    return this.ingredients.listMine(user.userId);
  }

  @Patch(':id')
  @ApiTags(TAGS.chefContent)
  @ApiOperation({
    summary: 'Correct one of my pending ingredients',
    description:
      'Recettes §7.1: only the fields sent change, and only while the ingredient is ' +
      "`pending` (`422` once validated or merged). Another batch cooker's ingredient " +
      'answers 404. A change to the name, aisle, allergens, diets or months is carried ' +
      "into this batch cooker's dishes that link it (Recettes §7.3).",
  })
  @ApiOkResponse({ description: 'The ingredient.', example: PRIVATE_INGREDIENT_EXAMPLE })
  @ApiConflictResponse({ description: 'The new name is already listed.' })
  @ApiUnprocessableEntityResponse({
    description:
      '`INGREDIENT_NOT_PENDING`, unknown aisle, or allergens together with `allergensNone`.',
  })
  @ApiForbiddenResponse(NOT_VERIFIED)
  @ApiNotFoundResponse({ description: 'No such ingredient among mine.' })
  @ApiClerkAuthResponses()
  update(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() payload: UpdateChefIngredientDto,
  ) {
    return this.ingredients.update(user.userId, id, payload);
  }
}
