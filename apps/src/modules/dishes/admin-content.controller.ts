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
} from '@nestjs/swagger';

import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { ApiAdminAuthResponses } from '../../common/swagger/auth-responses';
import { TAGS } from '../../common/swagger/tags';
import { UsersService } from '../users/users.service';
import {
  CreateLabsFoodMenuDto,
  OfferDto,
  UpdateLabsFoodMenuDto,
} from './dto/labs-food.dto';
import { LabsFoodContentService } from './labs-food-content.service';
import { MENU_EXAMPLE, MENU_ID } from './swagger-examples';

const LABS_FOOD_MENU_EXAMPLE = {
  ...MENU_EXAMPLE,
  createdByUserId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  offeredToChefProfileId: null,
};

const NOT_LABS_FOOD = {
  description: "`CONTENT_NOT_OWNED`: this belongs to a batch cooker, not to Lab's Food.",
  example: { code: 'CONTENT_NOT_OWNED', message: 'This menu belongs to a batch cooker.' },
};

const ApiMenuIdParam = () =>
  ApiParam({ name: 'id', description: "The Lab's Food menu id.", example: MENU_ID });

/**
 * Lab's Food content for batch cookers (FLOW-02 §6 and the PRD's offers): menus
 * suggested to every chef, and meals or menus prepared for one. Lab's Food meals
 * themselves are written through `/admin/meals`.
 */
@ApiBearerAuth()
@Controller('admin')
@UseGuards(ClerkAuthGuard, AdminGuard)
export class AdminContentController {
  constructor(
    private readonly content: LabsFoodContentService,
    private readonly users: UsersService,
  ) {}

  /** The admin's Postgres uuid: authorship and audit record a person. */
  private async adminId(user: ClerkUser): Promise<string> {
    const row = await this.users.findByClerkId(user.userId);
    return row!.id;
  }

  @Get('menus')
  @ApiTags(TAGS.adminCatalog)
  @ApiOperation({
    summary: "List Lab's Food menus",
    description:
      "Menus Lab's Food wrote, whatever their status. A `published` one nobody is " +
      '`offeredTo` is a suggestion every batch cooker can adopt. Not paginated.',
  })
  @ApiOkResponse({ description: 'The menus.', example: [LABS_FOOD_MENU_EXAMPLE] })
  @ApiAdminAuthResponses()
  listMenus() {
    return this.content.listMenus();
  }

  @Post('menus')
  @ApiTags(TAGS.adminCatalog)
  @ApiOperation({
    summary: "Write a Lab's Food menu",
    description:
      "Composes Lab's Food meals (from `GET /admin/meals`) into a menu. It belongs to " +
      'no batch cooker; you are recorded as its author. Publish it (`status: ' +
      '"published"`) to suggest it to every batch cooker.\n\n' +
      'A meal offered to one batch cooker cannot go in a menu.',
  })
  @ApiCreatedResponse({ description: 'The new menu.', example: LABS_FOOD_MENU_EXAMPLE })
  @ApiNotFoundResponse({ description: "A dish id is not a Lab's Food meal free to use." })
  @ApiAdminAuthResponses()
  async createMenu(
    @Body() payload: CreateLabsFoodMenuDto,
    @CurrentClerkUser() user: ClerkUser,
  ) {
    return this.content.createMenu(payload, await this.adminId(user));
  }

  @Patch('menus/:id')
  @ApiTags(TAGS.adminCatalog)
  @ApiOperation({
    summary: "Change a Lab's Food menu",
    description:
      "Any admin may change Lab's Food content. `dishIds` replaces the whole list. " +
      "Batch cookers' copies are theirs and are not changed.",
  })
  @ApiMenuIdParam()
  @ApiOkResponse({ description: 'The menu.', example: LABS_FOOD_MENU_EXAMPLE })
  @ApiConflictResponse({
    description:
      '`OFFER_PENDING`: it is offered to a batch cooker; withdraw the offer first.',
  })
  @ApiForbiddenResponse(NOT_LABS_FOOD)
  @ApiNotFoundResponse({
    description: 'No menu with this id, or a dish id that is not usable.',
  })
  @ApiAdminAuthResponses()
  updateMenu(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() payload: UpdateLabsFoodMenuDto,
  ) {
    return this.content.updateMenu(id, payload);
  }

  @Delete('menus/:id')
  @ApiTags(TAGS.adminCatalog)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Delete a Lab's Food menu",
    description: 'Its meals stay. Copies batch cookers made are theirs and stay too.',
  })
  @ApiMenuIdParam()
  @ApiNoContentResponse({ description: 'Deleted. No body.' })
  @ApiForbiddenResponse(NOT_LABS_FOOD)
  @ApiNotFoundResponse({ description: 'No menu with this id.' })
  @ApiAdminAuthResponses()
  deleteMenu(@Param('id', ParseUUIDPipe) id: string) {
    return this.content.deleteMenu(id);
  }

  @Post('meals/:id/offer')
  @ApiTags(TAGS.adminCatalog)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Offer a meal to one batch cooker',
    description:
      "Prepares a Lab's Food meal for one batch cooker: from now on only they see it, " +
      'in `GET /me/offers`, and it leaves the public suggestions. It becomes theirs ' +
      'only if they accept. You never set an owner yourself.\n\n' +
      'The meal becomes a `draft`. Offering it again moves the offer to someone else.',
  })
  @ApiParam({ name: 'id', description: "The Lab's Food meal id." })
  @ApiOkResponse({
    description: 'The offer.',
    example: {
      kind: 'meal',
      id: 'd3eebc99-9c0b-4ef8-bb6d-6bb9bd380a44',
      offeredToChefProfileId: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
    },
  })
  @ApiConflictResponse({
    description: "`MEAL_IN_MENU`: the meal is part of a Lab's Food menu; offer the menu.",
  })
  @ApiForbiddenResponse(NOT_LABS_FOOD)
  @ApiNotFoundResponse({ description: 'No such meal, or no such batch cooker.' })
  @ApiAdminAuthResponses()
  async offerMeal(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: OfferDto,
    @CurrentClerkUser() user: ClerkUser,
  ) {
    return this.content.offer('meal', id, body.chefProfileId, await this.adminId(user));
  }

  @Delete('meals/:id/offer')
  @ApiTags(TAGS.adminCatalog)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Withdraw a meal offer',
    description: "Before the batch cooker accepts. The meal stays with Lab's Food.",
  })
  @ApiParam({ name: 'id', description: "The Lab's Food meal id." })
  @ApiNoContentResponse({ description: 'Withdrawn. No body.' })
  @ApiForbiddenResponse(NOT_LABS_FOOD)
  @ApiNotFoundResponse({ description: 'No such meal.' })
  @ApiAdminAuthResponses()
  async withdrawMealOffer(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentClerkUser() user: ClerkUser,
  ) {
    return this.content.withdrawOffer('meal', id, await this.adminId(user));
  }

  @Post('menus/:id/offer')
  @ApiTags(TAGS.adminCatalog)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Offer a menu to one batch cooker',
    description:
      'As for a meal. When they accept, the menu becomes theirs and its meals are ' +
      'copied into their dishes.',
  })
  @ApiMenuIdParam()
  @ApiOkResponse({
    description: 'The offer.',
    example: {
      kind: 'menu',
      id: MENU_ID,
      offeredToChefProfileId: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
    },
  })
  @ApiForbiddenResponse(NOT_LABS_FOOD)
  @ApiNotFoundResponse({ description: 'No such menu, or no such batch cooker.' })
  @ApiAdminAuthResponses()
  async offerMenu(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: OfferDto,
    @CurrentClerkUser() user: ClerkUser,
  ) {
    return this.content.offer('menu', id, body.chefProfileId, await this.adminId(user));
  }

  @Delete('menus/:id/offer')
  @ApiTags(TAGS.adminCatalog)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Withdraw a menu offer',
    description: "Before the batch cooker accepts. The menu stays with Lab's Food.",
  })
  @ApiMenuIdParam()
  @ApiNoContentResponse({ description: 'Withdrawn. No body.' })
  @ApiForbiddenResponse(NOT_LABS_FOOD)
  @ApiNotFoundResponse({ description: 'No such menu.' })
  @ApiAdminAuthResponses()
  async withdrawMenuOffer(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentClerkUser() user: ClerkUser,
  ) {
    return this.content.withdrawOffer('menu', id, await this.adminId(user));
  }
}
