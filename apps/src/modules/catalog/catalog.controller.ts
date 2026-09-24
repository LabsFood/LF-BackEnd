import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
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
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { ApiAdminAuthResponses } from '../../common/swagger/auth-responses';
import { TAGS } from '../../common/swagger/tags';
import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard } from '../../auth/clerk-auth.guard';
import { CatalogService } from './catalog.service';
import {
  CreateMealDto,
  CreateMenuWeekDto,
  MealResponseDto,
  UpdateFormuleDto,
  UpdateMealDto,
} from './dto/catalog-admin.dto';

const MEAL = {
  id: 'd3eebc99-9c0b-4ef8-bb6d-6bb9bd380a44',
  name: 'Poulet yassa',
  description: 'Poulet mariné au citron et aux oignons, riz blanc.',
  imageUrl: null,
  continent: 'africa',
  country: 'Sénégal',
  portions: 4,
  prepTime: 45,
  dietaryTags: ['halal'],
  allergens: [],
  calories: 620,
  difficulty: 'medium',
  ingredients: [
    { name: 'Cuisses de poulet', amount: 8, unit: 'pièces', aisle: 'boucherie' },
  ],
  steps: ['Mariner le poulet', 'Faire revenir les oignons'],
  isFeatured: true,
  status: 'published',
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-03T14:12:00.000Z',
};

const MENU_WEEK = {
  id: 'e4eebc99-9c0b-4ef8-bb6d-6bb9bd380a55',
  weekNumber: 39,
  year: 2026,
  publishedAt: '2026-09-18T10:00:00.000Z',
  createdAt: '2026-09-15T09:00:00.000Z',
  updatedAt: '2026-09-18T10:00:00.000Z',
  meals: [
    { menuWeekId: 'e4eebc99-9c0b-4ef8-bb6d-6bb9bd380a55', mealId: MEAL.id, meal: MEAL },
  ],
};

const FORMULE = {
  id: 'confort',
  name: 'Confort',
  priceTtc: 9900,
  priceAfterTax: 4950,
  duration: '3 h',
  mealsCount: 5,
  persons: '2-6',
  features: ['5 plats', 'Courses incluses'],
  popular: true,
  active: true,
  createdAt: '2026-05-22T10:00:00.000Z',
  updatedAt: '2026-09-01T08:00:00.000Z',
};

const ApiMealIdParam = () =>
  ApiParam({
    name: 'id',
    description: 'The meal id, from `GET /admin/meals`.',
    example: MEAL.id,
  });

@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('menus/current')
  @ApiTags(TAGS.catalog)
  @ApiOperation({
    summary: 'Get the menu of the week',
    description:
      'The most recent weekly menu that has been published, with its meals. `meals` ' +
      'is the list to show; `menuWeek` says which week it is. Public: no token needed.\n\n' +
      'Answers `200` with an empty body when no menu has been published yet.',
  })
  @ApiOkResponse({
    description: 'The week and its meals.',
    example: { menuWeek: MENU_WEEK, meals: [MEAL] },
  })
  getCurrentMenu() {
    return this.catalog.getCurrentPublishedMenu();
  }

  @Get('admin/meals')
  @ApiTags(TAGS.adminCatalog)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'List every meal',
    description: 'All meals, whatever their status, newest first. Not paginated.',
  })
  @ApiOkResponse({
    description: 'The meals.',
    type: [MealResponseDto],
  })
  @ApiAdminAuthResponses()
  listMeals() {
    return this.catalog.listMeals();
  }

  @Post('admin/meals')
  @ApiTags(TAGS.adminCatalog)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Add a meal',
    description:
      'Only `name` and `prepTime` are required. The meal starts as a `draft` unless ' +
      '`status` says otherwise. For a photo, upload the file to storage first and ' +
      'send its address in `imageUrl`.\n\n' +
      'Example: `{ "name": "Poulet yassa", "prepTime": 45, "continent": "africa" }`.',
  })
  @ApiCreatedResponse({ description: 'The new meal.', type: MealResponseDto })
  @ApiAdminAuthResponses()
  createMeal(@Body() payload: CreateMealDto) {
    return this.catalog.createMeal(payload);
  }

  @Patch('admin/meals/:id')
  @ApiTags(TAGS.adminCatalog)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Change a meal',
    description:
      'Send only the fields to change. To empty an optional field, send `null`: ' +
      '`{ "imageUrl": null }` removes the photo. That works for `description`, ' +
      '`imageUrl`, `continent`, `country`, `calories` and `difficulty`.\n\n' +
      'To stop offering a meal, set `{ "status": "archived" }`.',
  })
  @ApiMealIdParam()
  @ApiOkResponse({ description: 'The updated meal.', type: MealResponseDto })
  @ApiAdminAuthResponses()
  updateMeal(@Param('id') id: string, @Body() payload: UpdateMealDto) {
    return this.catalog.updateMeal(id, payload);
  }

  @Delete('admin/meals/:id')
  @ApiTags(TAGS.adminCatalog)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Delete a meal',
    description:
      'Deletes the meal for good and takes it off every weekly menu. A meal that was ' +
      'ever booked cannot be deleted, to keep booking history: archive it instead ' +
      '(`PATCH` with `{ "status": "archived" }`).',
  })
  @ApiMealIdParam()
  @ApiNoContentResponse({ description: 'Deleted. No body.' })
  @ApiNotFoundResponse({ description: 'No meal with this id.' })
  @ApiConflictResponse({
    description: 'This meal was booked before. Archive it instead.',
  })
  @ApiAdminAuthResponses()
  deleteMeal(@Param('id') id: string) {
    return this.catalog.deleteMeal(id);
  }

  @Get('admin/menu-weeks')
  @ApiTags(TAGS.adminCatalog)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'List weekly menus',
    description:
      'Every weekly menu with its meals, most recent week first. `publishedAt: null` ' +
      'means not published yet. Not paginated.',
  })
  @ApiOkResponse({ description: 'The weekly menus.', example: [MENU_WEEK] })
  @ApiAdminAuthResponses()
  listMenuWeeks() {
    return this.catalog.listMenuWeeks();
  }

  @Post('admin/menu-weeks')
  @ApiTags(TAGS.adminCatalog)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Create a weekly menu',
    description:
      'Creates the menu for one ISO week and puts the given meals on it, for example ' +
      '`{ "year": 2026, "weekNumber": 40, "mealIds": ["d3eebc99-…"] }`. One menu per ' +
      'week.\n\n' +
      'The menu is created unpublished (`publishedAt: null`), and no route publishes ' +
      'it yet, so it will not appear in `GET /menus/current`.',
  })
  @ApiCreatedResponse({
    description: 'The new weekly menu.',
    example: { ...MENU_WEEK, weekNumber: 40, publishedAt: null },
  })
  @ApiAdminAuthResponses()
  createMenuWeek(@Body() payload: CreateMenuWeekDto) {
    return this.catalog.createMenuWeek(payload);
  }

  @Get('admin/formules')
  @ApiTags(TAGS.adminCatalog)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'List the pricing formules',
    description:
      'The packages clients choose from (`essentiel`, `confort`, `premium`, ' +
      '`sur-mesure`), with prices in cents: `priceTtc` before the tax credit, ' +
      '`priceAfterTax` what the client really pays after it.',
  })
  @ApiOkResponse({ description: 'The formules.', example: [FORMULE] })
  @ApiAdminAuthResponses()
  listFormules() {
    return this.catalog.listFormules();
  }

  @Patch('admin/formules/:id')
  @ApiTags(TAGS.adminCatalog)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Change a pricing formule',
    description:
      'Changes the name, prices, features or `active` flag. Send only the fields to ' +
      'change, for example `{ "priceTtc": 10900, "priceAfterTax": 5450 }`. ' +
      '`{ "active": false }` stops offering it to new clients.',
  })
  @ApiParam({ name: 'id', description: 'The formule id.', example: 'confort' })
  @ApiOkResponse({ description: 'The updated formule.', example: FORMULE })
  @ApiAdminAuthResponses()
  updateFormule(@Param('id') id: string, @Body() payload: UpdateFormuleDto) {
    return this.catalog.updateFormule(id, payload);
  }
}
