import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { ApiClerkAuthResponses } from '../../common/swagger/auth-responses';
import { TAGS } from '../../common/swagger/tags';
import { DishesService } from './dishes.service';
import { CreateDishDto, UpdateDishDto } from './dto/dish.dto';
import {
  CHEF_NOT_VERIFIED_EXAMPLE,
  CONTENT_NOT_OWNED_EXAMPLE,
  DISH_EXAMPLE,
  DISH_ID,
  PUBLISH_REFUSED_EXAMPLE,
} from './swagger-examples';

const NOT_VERIFIED = {
  description:
    '`CHEF_NOT_VERIFIED`: the candidature is not approved yet. Until then a batch ' +
    'cooker can read but not write.',
  example: CHEF_NOT_VERIFIED_EXAMPLE,
};

const NOT_OWNED = {
  description:
    '`CHEF_NOT_VERIFIED` (see above), or `CONTENT_NOT_OWNED`: the dish belongs to ' +
    'another batch cooker.',
  example: CONTENT_NOT_OWNED_EXAMPLE,
};

const ApiDishIdParam = () =>
  ApiParam({ name: 'id', description: 'The dish id.', example: DISH_ID });

/**
 * The signed-in batch cooker's dishes (FLOW-02 §3). Reads work for everyone with a
 * chef profile; writes need an approved candidature.
 */
@ApiBearerAuth()
@Controller('me')
@UseGuards(ClerkAuthGuard)
export class MeContentController {
  constructor(private readonly dishes: DishesService) {}

  @Get('dishes')
  @ApiTags(TAGS.chefContent)
  @ApiOperation({
    summary: 'List my dishes',
    description:
      'Every dish of the signed-in batch cooker, drafts included, most recently ' +
      'changed first, with the recipe. Not paginated.',
  })
  @ApiOkResponse({ description: 'The dishes.', example: [DISH_EXAMPLE] })
  @ApiNotFoundResponse({ description: 'This account has no batch cooker profile.' })
  @ApiClerkAuthResponses()
  listDishes(@CurrentClerkUser() user: ClerkUser) {
    return this.dishes.list(user.userId);
  }

  @Post('dishes')
  @ApiTags(TAGS.chefContent)
  @ApiOperation({
    summary: 'Create a dish',
    description:
      'Creates a `draft`: nothing is public until `POST /me/dishes/{id}/publish`.\n\n' +
      '- Only `name` and `prepMinutes` are required to save a draft.\n' +
      '- `allergens` takes ids from `GET /referentials/allergens`, `diets` from ' +
      '`GET /referentials/diets`. Anything else goes in `customAllergens` or ' +
      '`customDiets`.\n' +
      '- `allergensNone: true` says the dish has none of the 14 regulated allergens. ' +
      'It cannot be combined with a listed allergen.\n' +
      '- `recipe` stays private: the public site never shows it.\n\n' +
      'Example: `{ "name": "Poulet rôti aux herbes", "prepMinutes": 20, "country": "FR", ' +
      '"allergens": ["celery"] }`.',
  })
  @ApiCreatedResponse({
    description: 'The new draft.',
    example: { ...DISH_EXAMPLE, status: 'draft', publishedAt: null },
  })
  @ApiUnprocessableEntityResponse({
    description:
      '`VALIDATION_FAILED`: the declaration contradicts itself, for example ' +
      '`allergensNone` next to a listed allergen, or "gluten" typed as free text.',
  })
  @ApiForbiddenResponse(NOT_VERIFIED)
  @ApiNotFoundResponse({ description: 'This account has no batch cooker profile.' })
  @ApiClerkAuthResponses()
  createDish(@CurrentClerkUser() user: ClerkUser, @Body() payload: CreateDishDto) {
    return this.dishes.create(user.userId, payload);
  }

  @Get('dishes/:id')
  @ApiTags(TAGS.chefContent)
  @ApiOperation({
    summary: 'Get one of my dishes',
    description: "With its recipe. Another batch cooker's dish answers 404.",
  })
  @ApiDishIdParam()
  @ApiOkResponse({ description: 'The dish.', example: DISH_EXAMPLE })
  @ApiNotFoundResponse({ description: 'No such dish among mine.' })
  @ApiClerkAuthResponses()
  getDish(@CurrentClerkUser() user: ClerkUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.dishes.get(user.userId, id);
  }

  @Patch('dishes/:id')
  @ApiTags(TAGS.chefContent)
  @ApiOperation({
    summary: 'Change one of my dishes',
    description:
      'Send only the fields to change; `null` empties `description`, `country`, ' +
      '`category`, `cookMinutes` or `difficulty`. A `recipe` replaces the whole ' +
      'recipe.\n\n' +
      'A published dish stays published.',
  })
  @ApiDishIdParam()
  @ApiOkResponse({ description: 'The updated dish.', example: DISH_EXAMPLE })
  @ApiUnprocessableEntityResponse({
    description: '`VALIDATION_FAILED`: the declaration would contradict itself.',
  })
  @ApiForbiddenResponse(NOT_OWNED)
  @ApiNotFoundResponse({ description: 'No dish with this id.' })
  @ApiClerkAuthResponses()
  updateDish(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() payload: UpdateDishDto,
  ) {
    return this.dishes.update(user.userId, id, payload);
  }

  @Delete('dishes/:id')
  @ApiTags(TAGS.chefContent)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete one of my dishes',
    description:
      'For good. A dish that was ever booked stays, for the booking: unpublish it ' +
      'instead.',
  })
  @ApiDishIdParam()
  @ApiNoContentResponse({ description: 'Deleted. No body.' })
  @ApiConflictResponse({ description: 'This dish was booked. Unpublish it instead.' })
  @ApiForbiddenResponse(NOT_OWNED)
  @ApiNotFoundResponse({ description: 'No dish with this id.' })
  @ApiClerkAuthResponses()
  deleteDish(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.dishes.remove(user.userId, id);
  }

  @Post('dishes/:id/publish')
  @ApiTags(TAGS.chefContent)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Publish one of my dishes',
    description:
      'Puts the dish on the public site at once; admins look at it afterwards. ' +
      'Every check below must pass, and all failures are returned together:\n\n' +
      '- the batch cooker is approved and their dossier is `validated`, else ' +
      '`403 CHEF_NOT_VERIFIED`;\n' +
      '- `name`, `country` and `portions ≥ 1`, else `422 VALIDATION_FAILED`;\n' +
      '- an allergen declaration: `allergens` not empty, or `allergensNone: true`, ' +
      'else `422 ALLERGENS_REQUIRED`. Free-text allergens do not count.\n\n' +
      'The recipe is not required; `recipeComplete` says whether the fiche can be ' +
      'produced. Publishing a published dish changes nothing.',
  })
  @ApiDishIdParam()
  @ApiOkResponse({ description: 'The published dish.', example: DISH_EXAMPLE })
  @ApiUnprocessableEntityResponse({
    description: 'A check failed. `problems` lists every one.',
    example: PUBLISH_REFUSED_EXAMPLE,
  })
  @ApiForbiddenResponse(NOT_OWNED)
  @ApiNotFoundResponse({ description: 'No dish with this id.' })
  @ApiClerkAuthResponses()
  publishDish(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.dishes.publish(user.userId, id);
  }

  @Post('dishes/:id/unpublish')
  @ApiTags(TAGS.chefContent)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Unpublish one of my dishes',
    description:
      'Takes the dish off the public site; it goes back to `draft`. Changes nothing ' +
      'for a dish that is not published.',
  })
  @ApiDishIdParam()
  @ApiOkResponse({
    description: 'The dish, now a draft.',
    example: { ...DISH_EXAMPLE, status: 'draft' },
  })
  @ApiForbiddenResponse(NOT_OWNED)
  @ApiNotFoundResponse({ description: 'No dish with this id.' })
  @ApiClerkAuthResponses()
  unpublishDish(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.dishes.unpublish(user.userId, id);
  }
}
