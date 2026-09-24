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
  Put,
  Query,
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
  CreateMenuDto,
  PutShowcaseWeeksDto,
  ShowcaseRangeQueryDto,
  UpdateMenuDto,
} from './dto/menu.dto';
import { MenusService } from './menus.service';
import {
  CHEF_NOT_VERIFIED_EXAMPLE,
  CONTENT_NOT_OWNED_EXAMPLE,
  DISH_EXAMPLE,
  DISH_ID,
  MENU_EXAMPLE,
  MENU_ID,
  MENU_NOT_PUBLISHABLE_EXAMPLE,
  PUBLISH_REFUSED_EXAMPLE,
  SHOWCASE_EXAMPLE,
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

const ApiMenuIdParam = () =>
  ApiParam({ name: 'id', description: 'The menu id.', example: MENU_ID });

const MENU_NOT_OWNED = {
  description:
    '`CHEF_NOT_VERIFIED`, or `CONTENT_NOT_OWNED`: the menu belongs to another ' +
    'batch cooker.',
  example: { code: 'CONTENT_NOT_OWNED', message: 'This menu is not yours.' },
};

/**
 * The signed-in batch cooker's dishes (FLOW-02 §3). Reads work for everyone with a
 * chef profile; writes need an approved candidature.
 */
@ApiBearerAuth()
@Controller('me')
@UseGuards(ClerkAuthGuard)
export class MeContentController {
  constructor(
    private readonly dishes: DishesService,
    private readonly menus: MenusService,
  ) {}

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

  @Get('menus')
  @ApiTags(TAGS.chefContent)
  @ApiOperation({
    summary: 'List my menus',
    description:
      'Every menu of the signed-in batch cooker, drafts included, with its dishes in ' +
      'order and the status of each. Not paginated.',
  })
  @ApiOkResponse({ description: 'The menus.', example: [MENU_EXAMPLE] })
  @ApiNotFoundResponse({ description: 'This account has no batch cooker profile.' })
  @ApiClerkAuthResponses()
  listMenus(@CurrentClerkUser() user: ClerkUser) {
    return this.menus.list(user.userId);
  }

  @Post('menus')
  @ApiTags(TAGS.chefContent)
  @ApiOperation({
    summary: 'Create a menu',
    description:
      'A `draft` composed of the batch cooker’s own dishes, in the order of ' +
      '`dishIds`. A dish can sit in several menus, and a draft dish is fine: ' +
      'publishing the menu publishes it.\n\n' +
      '`shoppingIncluded` is `false` unless set: say `true` only if you do the ' +
      'shopping for this menu.\n\n' +
      'Example: `{ "title": "Semaine méditerranéenne", "dishIds": ["5b1f3c2e-…"] }`.',
  })
  @ApiCreatedResponse({
    description: 'The new draft.',
    example: { ...MENU_EXAMPLE, status: 'draft', publishedAt: null },
  })
  @ApiForbiddenResponse(MENU_NOT_OWNED)
  @ApiNotFoundResponse({
    description: 'No batch cooker profile, or a dish id that is not among yours.',
  })
  @ApiClerkAuthResponses()
  createMenu(@CurrentClerkUser() user: ClerkUser, @Body() payload: CreateMenuDto) {
    return this.menus.create(user.userId, payload);
  }

  @Get('menus/:id')
  @ApiTags(TAGS.chefContent)
  @ApiOperation({
    summary: 'Get one of my menus',
    description: "Another batch cooker's menu answers 404.",
  })
  @ApiMenuIdParam()
  @ApiOkResponse({ description: 'The menu.', example: MENU_EXAMPLE })
  @ApiNotFoundResponse({ description: 'No such menu among mine.' })
  @ApiClerkAuthResponses()
  getMenu(@CurrentClerkUser() user: ClerkUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.menus.get(user.userId, id);
  }

  @Patch('menus/:id')
  @ApiTags(TAGS.chefContent)
  @ApiOperation({
    summary: 'Change one of my menus',
    description:
      'Send only the fields to change. `dishIds` replaces the whole list, in its ' +
      'order.\n\n' +
      'A published menu stays published, so it can only take dishes that are ' +
      'already published: publish a new dish first, or unpublish the menu.',
  })
  @ApiMenuIdParam()
  @ApiOkResponse({ description: 'The updated menu.', example: MENU_EXAMPLE })
  @ApiUnprocessableEntityResponse({
    description:
      '`MENU_NOT_PUBLISHABLE`: the menu is published and a dish in `dishIds` is not.',
  })
  @ApiForbiddenResponse(MENU_NOT_OWNED)
  @ApiNotFoundResponse({
    description: 'No menu with this id, or a dish id that is not among yours.',
  })
  @ApiClerkAuthResponses()
  updateMenu(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() payload: UpdateMenuDto,
  ) {
    return this.menus.update(user.userId, id, payload);
  }

  @Delete('menus/:id')
  @ApiTags(TAGS.chefContent)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete one of my menus',
    description:
      'Its dishes stay. Weeks of the showcase that showed it fall back to "no menu".',
  })
  @ApiMenuIdParam()
  @ApiNoContentResponse({ description: 'Deleted. No body.' })
  @ApiForbiddenResponse(MENU_NOT_OWNED)
  @ApiNotFoundResponse({ description: 'No menu with this id.' })
  @ApiClerkAuthResponses()
  deleteMenu(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.menus.remove(user.userId, id);
  }

  @Post('menus/:id/publish')
  @ApiTags(TAGS.chefContent)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Publish one of my menus',
    description:
      'Puts the menu on the public site, **and publishes its draft dishes with it**: ' +
      'all or nothing. It needs:\n\n' +
      '- an approved batch cooker with a `validated` dossier, else ' +
      '`403 CHEF_NOT_VERIFIED`;\n' +
      '- a title and at least one dish;\n' +
      '- no suspended dish: an admin took it down, and only correcting and ' +
      'republishing it lifts that;\n' +
      '- every draft dish passing the checks of `POST /me/dishes/{id}/publish`.\n\n' +
      'If anything fails, nothing is published and `problems` lists the menu’s ' +
      'own problems and each dish’s.',
  })
  @ApiMenuIdParam()
  @ApiOkResponse({ description: 'The published menu.', example: MENU_EXAMPLE })
  @ApiUnprocessableEntityResponse({
    description: '`MENU_NOT_PUBLISHABLE`, with every problem.',
    example: MENU_NOT_PUBLISHABLE_EXAMPLE,
  })
  @ApiForbiddenResponse(MENU_NOT_OWNED)
  @ApiNotFoundResponse({ description: 'No menu with this id.' })
  @ApiClerkAuthResponses()
  publishMenu(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.menus.publish(user.userId, id);
  }

  @Post('menus/:id/unpublish')
  @ApiTags(TAGS.chefContent)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Unpublish one of my menus',
    description: 'Back to `draft`. Its dishes stay published.',
  })
  @ApiMenuIdParam()
  @ApiOkResponse({
    description: 'The menu, now a draft.',
    example: { ...MENU_EXAMPLE, status: 'draft' },
  })
  @ApiForbiddenResponse(MENU_NOT_OWNED)
  @ApiNotFoundResponse({ description: 'No menu with this id.' })
  @ApiClerkAuthResponses()
  unpublishMenu(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.menus.unpublish(user.userId, id);
  }

  @Get('showcase/weeks')
  @ApiTags(TAGS.chefContent)
  @ApiOperation({
    summary: 'See which menu I show each week',
    description:
      'The "Vitrine du mois": the menu assigned to each week, `null` for a week ' +
      'without one. Weeks never assigned are not listed. By default, the next eight ' +
      'weeks from this one.',
  })
  @ApiOkResponse({ description: 'The weeks.', example: SHOWCASE_EXAMPLE })
  @ApiNotFoundResponse({ description: 'This account has no batch cooker profile.' })
  @ApiClerkAuthResponses()
  showcase(@CurrentClerkUser() user: ClerkUser, @Query() range: ShowcaseRangeQueryDto) {
    return this.menus.showcase(user.userId, range);
  }

  @Put('showcase/weeks')
  @ApiTags(TAGS.chefContent)
  @ApiOperation({
    summary: 'Choose which menu I show each week',
    description:
      'Assigns a menu to each week given, or `null` for "no menu this week": the ' +
      'public page then shows your published dishes only, after the batch cookers ' +
      'who have a menu. Weeks left out keep what they had.\n\n' +
      '`weekStart` is always a Monday. A draft menu may be assigned; it shows ' +
      'publicly once published.\n\n' +
      'Example: `{ "assignments": [{ "weekStart": "2026-09-28", "menuId": "3a9d…" }, ' +
      '{ "weekStart": "2026-10-05", "menuId": null }] }`.',
  })
  @ApiOkResponse({
    description: 'The weeks from the first to the last one given.',
    example: SHOWCASE_EXAMPLE,
  })
  @ApiUnprocessableEntityResponse({
    description: '`VALIDATION_FAILED`: a `weekStart` is not a Monday, or given twice.',
  })
  @ApiForbiddenResponse(NOT_VERIFIED)
  @ApiNotFoundResponse({ description: 'One of the menus is not among yours.' })
  @ApiClerkAuthResponses()
  putShowcase(@CurrentClerkUser() user: ClerkUser, @Body() payload: PutShowcaseWeeksDto) {
    return this.menus.putShowcase(user.userId, payload);
  }
}
