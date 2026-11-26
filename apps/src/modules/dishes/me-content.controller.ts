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
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import type { FastifyReply } from 'fastify';

import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { ParseVersionPipe } from '../../common/pipes/version-param.pipe';
import { ApiClerkAuthResponses } from '../../common/swagger/auth-responses';
import { TAGS } from '../../common/swagger/tags';
import { DishesService } from './dishes.service';
import { DuplicationService } from './duplication.service';
import {
  ConfirmAllergensDto,
  CreateDishDto,
  RestoreVersionDto,
  UpdateDishDto,
} from './dto/dish.dto';
import {
  CreateMenuDto,
  PutShowcaseWeeksDto,
  ShowcaseRangeQueryDto,
  UpdateMenuDto,
} from './dto/menu.dto';
import { ContentPhotosService } from './content-photos.service';
import { ConsentDto } from './dto/labs-food.dto';
import {
  PHOTO_UPLOAD_EXAMPLE,
  PhotoConfirmDto,
  PhotoUploadDto,
  photoStepsHelp,
} from './dto/photo.dto';
import { MenusService } from './menus.service';
import { RecipeVersionsService } from './recipe-versions.service';
import { SuggestionsService } from './suggestions.service';
import {
  CHEF_NOT_VERIFIED_EXAMPLE,
  CONTENT_NOT_OWNED_EXAMPLE,
  DISH_EXAMPLE,
  DISH_ID,
  DUPLICATE_INGREDIENT_LINE_EXAMPLE,
  INGREDIENT_NOT_LINKED_EXAMPLE,
  MENU_EXAMPLE,
  MENU_ID,
  MENU_NOT_PUBLISHABLE_EXAMPLE,
  PUBLISH_REFUSED_EXAMPLE,
  RECIPE_CONFLICT_EXAMPLE,
  SHOWCASE_EXAMPLE,
  CONSENT_REQUIRED_EXAMPLE,
  SUGGESTIONS_EXAMPLE,
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
    private readonly suggestions: SuggestionsService,
    private readonly photos: ContentPhotosService,
    private readonly duplication: DuplicationService,
    private readonly versions: RecipeVersionsService,
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
      '- Allergens are computed from the recipe lines linked to the common ingredient ' +
      'list (Recettes §6.1): the dish returns them in `allergens`, `conditionalAllergens` ' +
      'and `allergensNone`, never sent. `addedAllergens` adds regulated ones on top, ids ' +
      'from `GET /referentials/allergens`; none can be taken away.\n' +
      '- `diets` takes ids from `GET /referentials/diets`. Anything else goes in ' +
      '`customAllergens` or `customDiets`.\n' +
      '- Each `recipe.ingredients` line is checked: a unit among the 14, a quantity ' +
      'above 0 unless `to_taste` or to verify, a linked ingredient the batch cooker may ' +
      'use. A linked line takes the name, aisle and allergens of its ingredient.\n' +
      '- `recipe` stays private: the public site never shows it.\n\n' +
      'Example: `{ "name": "Poulet rôti aux herbes", "prepMinutes": 20, "country": "FR", ' +
      '"addedAllergens": ["celery"] }`.',
  })
  @ApiCreatedResponse({
    description: 'The new draft.',
    example: { ...DISH_EXAMPLE, status: 'draft', publishedAt: null },
  })
  @ApiUnprocessableEntityResponse({
    description:
      '`VALIDATION_FAILED`: "gluten" typed as free text next to the list, an ingredient ' +
      'line that breaks the rules or links an ingredient this batch cooker cannot use ' +
      '(`errors` names the line). `DUPLICATE_INGREDIENT_LINE`: two lines of the same ' +
      'group link the same ingredient with the same precision (`lines` groups their ' +
      'indexes).',
    example: DUPLICATE_INGREDIENT_LINE_EXAMPLE,
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

  @Get('dishes/:id/versions')
  @ApiTags(TAGS.chefContent)
  @ApiOperation({
    summary: 'List the versions of one of my dishes',
    description:
      'Recettes §8.2: the frozen versions of the recipe, newest first. `bookings` counts ' +
      'the bookings that pin each one; `current` marks the version the dish is at.',
  })
  @ApiDishIdParam()
  @ApiOkResponse({
    description: 'The versions.',
    example: [
      { version: 2, createdAt: '2026-11-01T09:00:00.000Z', bookings: 3, current: true },
      { version: 1, createdAt: '2026-10-01T08:00:00.000Z', bookings: 0, current: false },
    ],
  })
  @ApiNotFoundResponse({ description: 'No such dish among mine.' })
  @ApiClerkAuthResponses()
  listVersions(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.versions.list(user.userId, id);
  }

  @Get('dishes/:id/versions/:version')
  @ApiTags(TAGS.chefContent)
  @ApiOperation({
    summary: 'Read one version of one of my dishes',
    description:
      'Recettes §8.2: its portions, ingredients, steps, reheating and storage.',
  })
  @ApiDishIdParam()
  @ApiParam({ name: 'version', description: 'The version number.', example: 1 })
  @ApiOkResponse({ description: 'The version.' })
  @ApiNotFoundResponse({ description: 'No such dish among mine, or no such version.' })
  @ApiClerkAuthResponses()
  getVersion(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('version', ParseVersionPipe) version: number,
  ) {
    return this.versions.get(user.userId, id, version);
  }

  @Post('dishes/:id/versions/:version/restore')
  @HttpCode(HttpStatus.OK)
  @ApiTags(TAGS.chefContent)
  @ApiOperation({
    summary: 'Restore a version into one of my dishes',
    description:
      'Recettes §8.2: copies the version into the dish, then the rules of a normal save ' +
      'apply (`PATCH /me/dishes/{id}`): allergens computed again, verification cleared ' +
      'if they changed, `versionPending`, and a new version if the recipe is "Prête". ' +
      'History is never erased. A line linked to an ingredient merged since then is ' +
      'repointed to its replacement; one whose ingredient is gone becomes a line to ' +
      'verify.',
  })
  @ApiDishIdParam()
  @ApiParam({ name: 'version', description: 'The version number.', example: 1 })
  @ApiBody({ type: RestoreVersionDto, required: false })
  @ApiOkResponse({ description: 'The updated dish.', example: DISH_EXAMPLE })
  @ApiConflictResponse({
    description:
      '`RECIPE_CONFLICT`: the dish changed since this `lockVersion` was read. Reload it.',
    example: RECIPE_CONFLICT_EXAMPLE,
  })
  @ApiUnprocessableEntityResponse({
    description:
      '`VALIDATION_FAILED`: the restored recipe breaks a rule of a save (`errors` names ' +
      'the line), or a limit is reached.',
    example: DUPLICATE_INGREDIENT_LINE_EXAMPLE,
  })
  @ApiForbiddenResponse(NOT_VERIFIED)
  @ApiNotFoundResponse({ description: 'No such dish among mine, or no such version.' })
  @ApiClerkAuthResponses()
  restoreVersion(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('version', ParseVersionPipe) version: number,
    @Body() payload: RestoreVersionDto,
  ) {
    return this.versions.restore(user.userId, id, version, payload?.lockVersion);
  }

  @Patch('dishes/:id')
  @ApiTags(TAGS.chefContent)
  @ApiOperation({
    summary: 'Change one of my dishes',
    description:
      'Send only the fields to change; `null` empties `description`, `country`, ' +
      '`category`, `cookMinutes` or `difficulty`. A `recipe` replaces the whole ' +
      'recipe, its lines checked as on `POST /me/dishes`.\n\n' +
      '- Send back the `lockVersion` the dish was read with: if it changed since (another ' +
      'screen, or Lab’s Food correcting an ingredient), the answer is ' +
      '`409 RECIPE_CONFLICT` with the current `lockVersion`, and nothing is written. ' +
      'Each save moves it on by one.\n' +
      '- `allergens`, `conditionalAllergens` and `allergensNone` are computed again ' +
      'from the lines and `addedAllergens`. An allergen declared by hand before they ' +
      'were computed is never dropped: it is kept in `addedAllergens`, from where the ' +
      'batch cooker may remove it. A line added, removed or relinked, a line that ' +
      'becomes optional or stops being so, or a change to the allergens, clears ' +
      '`allergensVerifiedAt`, even one confirmed after this dish was read: confirm ' +
      'them again (`POST /me/dishes/{id}/allergens/confirm`). A quantity does not.\n' +
      '- A published dish stays published, even if the recipe is no longer "Prête"; it ' +
      'cannot be booked until its allergens are confirmed.',
  })
  @ApiDishIdParam()
  @ApiOkResponse({ description: 'The updated dish.', example: DISH_EXAMPLE })
  @ApiConflictResponse({
    description:
      '`RECIPE_CONFLICT`: the dish changed since this `lockVersion` was read. Reload it.',
    example: RECIPE_CONFLICT_EXAMPLE,
  })
  @ApiUnprocessableEntityResponse({
    description:
      '`VALIDATION_FAILED`: a free text repeats an entry of the lists, or an ingredient ' +
      'line breaks the rules or links an ingredient this batch cooker cannot use ' +
      '(`errors` names the line). `DUPLICATE_INGREDIENT_LINE`: the same ingredient on ' +
      'two lines (`lines`).',
    example: DUPLICATE_INGREDIENT_LINE_EXAMPLE,
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
      'The batch cooker must be approved with a `validated` dossier, else ' +
      '`403 CHEF_NOT_VERIFIED`. Then the recipe must be "Prête" (Recettes §4.11) and ' +
      'have a short description, else `422 RECIPE_NOT_READY` with every point in ' +
      '`problems` (`readiness` on the dish says the same beforehand): name, type, ' +
      'portions, cooking time, an ingredient, none still to verify ' +
      '(`INGREDIENT_TO_VERIFY`), each linked to the common list (`INGREDIENT_NOT_LINKED`) ' +
      'and complete (`INGREDIENT_INCOMPLETE`), each with a quantity above 0 and a unit ' +
      'unless `to_taste` (`VALIDATION_FAILED` on `recipe.ingredients[i].qty` or ' +
      '`.unit`), a step, each typed (`STEP_TYPE_MISSING`), ' +
      'storage, reheating, allergens confirmed since the last ingredient change ' +
      '(`ALLERGENS_UNVERIFIED`), and a photo (`PHOTO_MISSING`). Origin and equipment are ' +
      'never asked.\n\n' +
      'Publishing a published dish changes nothing.',
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

  @Post('dishes/:id/duplicate')
  @ApiTags(TAGS.chefContent)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Copy one of my dishes',
    description:
      'Recettes §5.4: a new draft named "[name] (copie)", never published, linked to the ' +
      'original by `variantOfId`. Its allergens are to confirm again and its version ' +
      'starts over; its photo is a copy of the file. A dish can be copied any number ' +
      'of times.',
  })
  @ApiDishIdParam()
  @ApiCreatedResponse({ description: 'The copy.', example: DISH_EXAMPLE })
  @ApiNotFoundResponse({ description: 'No dish of mine with this id.' })
  @ApiClerkAuthResponses()
  duplicateDish(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.duplication.dish(user.userId, id);
  }

  @Get('dishes/:id/recipe.pdf')
  @ApiTags(TAGS.chefContent)
  @ApiOperation({
    summary: 'Download the recipe sheet of one of my dishes',
    description:
      'Recettes §7: the sheet as it stands, as a PDF/A with a LAB’S FOOD watermark ' +
      'on every page: ingredients (fixed quantities marked), typed steps, allergens, ' +
      'equipment, storage and reheating.',
  })
  @ApiDishIdParam()
  @ApiProduces('application/pdf')
  @ApiOkResponse({
    description: 'The PDF, as an attachment.',
    content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiNotFoundResponse({ description: 'No dish of mine with this id.' })
  @ApiClerkAuthResponses()
  async recipePdf(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { filename, body } = await this.dishes.recipePdf(user.userId, id);
    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('Cache-Control', 'private, no-store');
    return body;
  }

  @Post('dishes/:id/allergens/confirm')
  @ApiTags(TAGS.chefContent)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm the allergens of one of my dishes',
    description:
      'Recettes §4.9: the batch cooker confirms the allergens computed from the ' +
      'ingredients, plus the ones they added, are right. Sets `allergensVerifiedAt`, ' +
      'needed for the dish to be ready and to be booked. Adding, removing or changing ' +
      'an ingredient, or a change to the allergens, clears it again; a quantity does ' +
      'not. A confirmation never moves `lockVersion`.\n\n' +
      '- The allergens are computed again from the common ingredient list as it is ' +
      'now. If that gives something other than what the dish shows (lines never ' +
      'computed, an ingredient corrected since), the new result is saved unconfirmed, ' +
      '`lockVersion` moves on, and the answer is `409 RECIPE_CONFLICT` with it: reload ' +
      'the dish, check the allergens and confirm again.\n' +
      '- The body is optional. Send `{ "lockVersion": 4 }`, the one the allergens were ' +
      'read with: if the dish changed since (another screen, Lab’s Food correcting an ' +
      'ingredient), the answer is `409 RECIPE_CONFLICT` with the current `lockVersion` ' +
      'and nothing is confirmed. With or without it, a change landing during the ' +
      'confirmation answers the same 409.\n' +
      '- `422 VALIDATION_FAILED` while the recipe has no ingredient.\n' +
      '- `422 INGREDIENT_NOT_LINKED` while a line is not linked to the common list, or ' +
      'links an ingredient still to complete: `lines` gives their indexes.\n' +
      '- `422 VALIDATION_FAILED` with `allergens` while an allergen code is not one of ' +
      'the 14 regulated ones (a legacy or renamed code): it must be corrected first.',
  })
  @ApiDishIdParam()
  @ApiBody({ type: ConfirmAllergensDto, required: false })
  @ApiOkResponse({
    description: 'The dish, with `allergensVerifiedAt`.',
    example: DISH_EXAMPLE,
  })
  @ApiConflictResponse({
    description:
      '`RECIPE_CONFLICT` with the current `lockVersion`: the dish changed since it was ' +
      'read, or its allergens were just computed again and differ. Nothing is ' +
      'confirmed: reload it and check the allergens again.',
    example: RECIPE_CONFLICT_EXAMPLE,
  })
  @ApiUnprocessableEntityResponse({
    description:
      'The allergens cannot be confirmed yet: no ingredient (`VALIDATION_FAILED`), a ' +
      'line not linked or incomplete (`INGREDIENT_NOT_LINKED`, with `lines`), or a code ' +
      'outside the 14 (`VALIDATION_FAILED`, with `allergens`).',
    example: INGREDIENT_NOT_LINKED_EXAMPLE,
  })
  @ApiForbiddenResponse(NOT_OWNED)
  @ApiNotFoundResponse({ description: 'No dish with this id.' })
  @ApiClerkAuthResponses()
  confirmDishAllergens(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() payload: ConfirmAllergensDto,
  ) {
    // A missing body arrives as `{}` (the validation pipe): `lockVersion` is optional.
    return this.dishes.confirmAllergens(user.userId, id, payload?.lockVersion);
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
      'order, each in full as `GET /me/dishes` shows it. Not paginated.',
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

  @Post('menus/:id/duplicate')
  @ApiTags(TAGS.chefContent)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Copy one of my menus',
    description:
      'Recettes §5.4: a new draft named "[title] (copie)", never published, holding the ' +
      'same dishes in the same order (no dish is copied). The cover photo is a copy ' +
      'of the file.',
  })
  @ApiMenuIdParam()
  @ApiCreatedResponse({
    description: 'The copy.',
    example: { ...MENU_EXAMPLE, status: 'draft', publishedAt: null },
  })
  @ApiNotFoundResponse({ description: 'No menu of mine with this id.' })
  @ApiClerkAuthResponses()
  duplicateMenu(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.duplication.menu(user.userId, id);
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

  @Get('suggestions')
  @ApiTags(TAGS.chefContent)
  @ApiOperation({
    summary: "Browse Lab's Food suggestions",
    description:
      "Dishes and menus Lab's Food offers every batch cooker as a starting point. A " +
      'preview only: never the ingredients or steps.\n\n' +
      '`adoptedCopyId` is the id of your copy when you already adopted it, else `null`. ' +
      'Dishes the team featured (`isFeatured`) come first, then the others, by name.',
  })
  @ApiOkResponse({ description: 'The suggestions.', example: SUGGESTIONS_EXAMPLE })
  @ApiNotFoundResponse({ description: 'This account has no batch cooker profile.' })
  @ApiClerkAuthResponses()
  listSuggestions(@CurrentClerkUser() user: ClerkUser) {
    return this.suggestions.list(user.userId);
  }

  @Post('suggestions/:id/adopt')
  @ApiTags(TAGS.chefContent)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Adopt a Lab's Food suggestion",
    description:
      'Copies the dish or menu into your own, as a `draft` you are free to change, ' +
      'publish or delete. Nothing is imposed: you choose, and your consent is ' +
      'recorded.\n\n' +
      '- Body: `{ "consent": true }`, else `422 CONSENT_REQUIRED`.\n' +
      '- Adopting again gives back the copy you already have (`created: false`).\n' +
      '- A menu brings its dishes; a dish you already adopted is reused, not copied ' +
      'twice.\n\n' +
      "If Lab's Food later corrects the allergens, diets or country of the " +
      'suggestion, your copy is flagged (`sourceChangedAt`) and you are emailed. It ' +
      'is never changed for you.',
  })
  @ApiParam({
    name: 'id',
    description: 'The dish or menu id, from `GET /me/suggestions`.',
  })
  @ApiOkResponse({
    description: 'Your copy, and whether it was just made.',
    example: { type: 'dish', created: true, copy: DISH_EXAMPLE },
  })
  @ApiUnprocessableEntityResponse({
    description: '`CONSENT_REQUIRED`.',
    example: CONSENT_REQUIRED_EXAMPLE,
  })
  @ApiForbiddenResponse(NOT_VERIFIED)
  @ApiNotFoundResponse({ description: 'No such suggestion.' })
  @ApiClerkAuthResponses()
  adopt(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ConsentDto,
  ) {
    return this.suggestions.adopt(user.userId, id, body.consent);
  }

  @Get('offers')
  @ApiTags(TAGS.chefContent)
  @ApiOperation({
    summary: "See what Lab's Food prepared for me",
    description:
      'Dishes and menus Lab’s Food prepared for you alone. Nobody else sees them. ' +
      'Accept one to make it yours, or decline it. A preview only, like suggestions. ' +
      'Featured dishes (`isFeatured`) come first, then the latest.',
  })
  @ApiOkResponse({
    description: 'The offers.',
    example: { dishes: SUGGESTIONS_EXAMPLE.dishes, menus: [] },
  })
  @ApiNotFoundResponse({ description: 'This account has no batch cooker profile.' })
  @ApiClerkAuthResponses()
  listOffers(@CurrentClerkUser() user: ClerkUser) {
    return this.suggestions.offers(user.userId);
  }

  @Post('offers/:id/accept')
  @ApiTags(TAGS.chefContent)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept an offer',
    description:
      'The offered dish or menu becomes yours, as a `draft`. No copy: the offer ' +
      'itself changes hands, and your consent is recorded. An offered menu’s dishes ' +
      'are copied into yours, as on an adoption.\n\n' +
      'Body: `{ "consent": true }`, else `422 CONSENT_REQUIRED`.',
  })
  @ApiParam({ name: 'id', description: 'The dish or menu id, from `GET /me/offers`.' })
  @ApiOkResponse({
    description: 'What is now yours.',
    example: { type: 'dish', dish: { ...DISH_EXAMPLE, status: 'draft' } },
  })
  @ApiUnprocessableEntityResponse({
    description: '`CONSENT_REQUIRED`.',
    example: CONSENT_REQUIRED_EXAMPLE,
  })
  @ApiForbiddenResponse(NOT_VERIFIED)
  @ApiNotFoundResponse({ description: 'No such offer for you.' })
  @ApiClerkAuthResponses()
  acceptOffer(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ConsentDto,
  ) {
    return this.suggestions.accept(user.userId, id, body.consent);
  }

  @Post('offers/:id/decline')
  @ApiTags(TAGS.chefContent)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Decline an offer',
    description: "It goes back to Lab's Food, which may offer it to someone else.",
  })
  @ApiParam({ name: 'id', description: 'The dish or menu id, from `GET /me/offers`.' })
  @ApiNoContentResponse({ description: 'Declined. No body.' })
  @ApiNotFoundResponse({ description: 'No such offer for you.' })
  @ApiForbiddenResponse(NOT_VERIFIED)
  @ApiClerkAuthResponses()
  declineOffer(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.suggestions.decline(user.userId, id);
  }

  @Post('dishes/:id/photo/upload-url')
  @ApiTags(TAGS.chefContent)
  @ApiOperation({
    summary: 'Add a photo to my dish, step 1 of 3: get an upload link',
    description:
      'Three calls, and the file never goes through this API:\n\n' +
      '1. This call, with the picture’s type and size. It answers with a private ' +
      '`url` valid 15 minutes and an `uploadId`.\n' +
      '2. `PUT` the file to that `url`, with the `headers` given. Its length must be ' +
      'exactly `sizeBytes`: storage refuses anything else (403).\n' +
      '3. `POST /me/dishes/{id}/photo/confirm` with the `uploadId`.\n\n' +
      'JPEG, PNG or WebP, 5 MB at most. Answers `503 PHOTOS_UNAVAILABLE` when this ' +
      'server has no photo storage.',
  })
  @ApiDishIdParam()
  @ApiCreatedResponse({
    description: 'Where to send the file.',
    example: {
      uploadId: 'ph_9f2a1c4e7b30d85a61c2e4f7',
      method: 'PUT',
      url: 'https://<account>.r2.cloudflarestorage.com/<bucket>/chefs/…?X-Amz-Signature=…',
      headers: { 'Content-Type': 'image/jpeg' },
      expiresAt: '2026-09-24T10:15:00.000Z',
    },
  })
  @ApiUnprocessableEntityResponse({
    description: '`UNSUPPORTED_MEDIA_TYPE` or `FILE_TOO_LARGE`.',
  })
  @ApiForbiddenResponse(NOT_OWNED)
  @ApiNotFoundResponse({ description: 'No dish with this id.' })
  @ApiClerkAuthResponses()
  photoUploadUrl(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() payload: PhotoUploadDto,
  ) {
    return this.photos.uploadUrl(user.userId, 'dish', id, payload);
  }

  @Post('dishes/:id/photo/confirm')
  @ApiTags(TAGS.chefContent)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Add a photo to my dish, step 3 of 3: confirm',
    description:
      'Once the `PUT` succeeded. The API checks the file is really there, with the ' +
      'type and size announced, then makes it the dish’s photo; the previous one is ' +
      'deleted. A new photo on a published dish sends it back to the admin review ' +
      'queue.\n\nExample: `{ "uploadId": "ph_9f2a…", "contentType": "image/jpeg" }`.',
  })
  @ApiDishIdParam()
  @ApiOkResponse({
    description: 'The dish, with its photo.',
    example: {
      ...DISH_EXAMPLE,
      imageUrl:
        'https://photos.labsfood.fr/chefs/c2eebc99…/dishes/5b1f3c2e…/ph_9f2a….jpg',
    },
  })
  @ApiConflictResponse({
    description: '`UPLOAD_NOT_CONFIRMED`: no file arrived for this `uploadId`.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      '`UNSUPPORTED_MEDIA_TYPE`: the file does not match the type and size announced.',
  })
  @ApiForbiddenResponse(NOT_OWNED)
  @ApiNotFoundResponse({ description: 'No dish with this id.' })
  @ApiClerkAuthResponses()
  confirmPhoto(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() payload: PhotoConfirmDto,
  ) {
    return this.photos.confirm(user.userId, 'dish', id, payload);
  }

  @Delete('dishes/:id/photo')
  @ApiTags(TAGS.chefContent)
  @ApiOperation({
    summary: 'Remove my dish’s photo',
    description: 'The dish stays as it is otherwise.',
  })
  @ApiDishIdParam()
  @ApiOkResponse({
    description: 'The dish, without a photo.',
    example: { ...DISH_EXAMPLE, imageUrl: null },
  })
  @ApiForbiddenResponse(NOT_OWNED)
  @ApiNotFoundResponse({ description: 'No dish with this id.' })
  @ApiClerkAuthResponses()
  removePhoto(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.photos.remove(user.userId, 'dish', id);
  }

  @Post('menus/:id/photo/upload-url')
  @ApiTags(TAGS.chefContent)
  @ApiOperation({
    summary: 'Add a cover photo to my menu, step 1 of 3: get an upload link',
    description: photoStepsHelp('/me/menus/{id}/photo/confirm'),
  })
  @ApiMenuIdParam()
  @ApiCreatedResponse({
    description: 'Where to send the file.',
    example: PHOTO_UPLOAD_EXAMPLE,
  })
  @ApiUnprocessableEntityResponse({
    description: '`UNSUPPORTED_MEDIA_TYPE` or `FILE_TOO_LARGE`.',
  })
  @ApiForbiddenResponse(NOT_OWNED)
  @ApiNotFoundResponse({ description: 'No menu with this id.' })
  @ApiClerkAuthResponses()
  menuPhotoUploadUrl(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() payload: PhotoUploadDto,
  ) {
    return this.photos.uploadUrl(user.userId, 'menu', id, payload);
  }

  @Post('menus/:id/photo/confirm')
  @ApiTags(TAGS.chefContent)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Add a cover photo to my menu, step 3 of 3: confirm',
    description:
      'Once the `PUT` succeeded. The API checks the file is really there, with the ' +
      'type and size announced, then makes it the menu’s cover; the previous one is ' +
      'deleted. A new photo on a published menu sends it back to the admin review queue.',
  })
  @ApiMenuIdParam()
  @ApiOkResponse({
    description: 'The menu, with its cover.',
    example: {
      ...MENU_EXAMPLE,
      imageUrl: 'https://photos.labsfood.fr/chefs/c2eebc99…/menus/8d2e…/ph_9f2a….jpg',
    },
  })
  @ApiConflictResponse({
    description: '`UPLOAD_NOT_CONFIRMED`: no file arrived for this `uploadId`.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      '`UNSUPPORTED_MEDIA_TYPE`: the file does not match the type and size announced.',
  })
  @ApiForbiddenResponse(NOT_OWNED)
  @ApiNotFoundResponse({ description: 'No menu with this id.' })
  @ApiClerkAuthResponses()
  confirmMenuPhoto(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() payload: PhotoConfirmDto,
  ) {
    return this.photos.confirm(user.userId, 'menu', id, payload);
  }

  @Delete('menus/:id/photo')
  @ApiTags(TAGS.chefContent)
  @ApiOperation({
    summary: 'Remove my menu’s cover photo',
    description: 'The menu stays as it is otherwise.',
  })
  @ApiMenuIdParam()
  @ApiOkResponse({
    description: 'The menu, without a cover.',
    example: { ...MENU_EXAMPLE, imageUrl: null },
  })
  @ApiForbiddenResponse(NOT_OWNED)
  @ApiNotFoundResponse({ description: 'No menu with this id.' })
  @ApiClerkAuthResponses()
  removeMenuPhoto(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.photos.remove(user.userId, 'menu', id);
  }
}
