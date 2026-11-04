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

import { ApiAdminAuthResponses } from '../../common/swagger/auth-responses';
import { TAGS } from '../../common/swagger/tags';
import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { Meal } from '../../generated/prisma/client';
import { readiness } from '../dishes/domain/dishes.rules';
import { UsersService } from '../users/users.service';
import {
  CatalogService,
  NOT_LABS_FOOD as NOT_LABS_FOOD_MESSAGE,
} from './catalog.service';
import {
  CreateMealDto,
  CreateMenuWeekDto,
  MealResponseDto,
  UpdateFormuleDto,
  UpdateMealDto,
  UpdateMenuWeekDto,
} from './dto/catalog-admin.dto';

const MEAL = {
  id: 'd3eebc99-9c0b-4ef8-bb6d-6bb9bd380a44',
  chefProfileId: null,
  createdByUserId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  offeredToChefProfileId: null,
  name: 'Poulet yassa',
  description: 'Poulet mariné au citron et aux oignons, riz blanc.',
  imageUrl: null,
  continent: 'africa',
  country: 'SN',
  portions: 4,
  prepTime: 45,
  dietaryTags: ['halal'],
  allergens: [],
  calories: 620,
  difficulty: 'medium',
  allergensNone: true,
  customDiets: [],
  customAllergens: [],
  category: 'main',
  cookTime: 40,
  ingredients: [{ name: 'Cuisses de poulet', qty: 8, unit: 'piece', aisle: 'boucherie' }],
  steps: [
    { order: 1, text: 'Mariner le poulet', type: 'preparation', durationMinutes: 60 },
    { order: 2, text: 'Faire revenir les oignons', type: 'cuisson', durationMinutes: 10 },
  ],
  reheating: { mode: 'oven', temperature: 160, minutes: 15, note: null },
  storage: { method: 'fridge', days: 3, container: null },
  publishedAt: '2026-09-03T14:12:00.000Z',
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

const NOT_LABS_FOOD = {
  description:
    "`CONTENT_NOT_OWNED`: this meal is a batch cooker's dish. These routes only " +
    "change Lab's Food meals.",
  example: {
    code: 'CONTENT_NOT_OWNED',
    message: NOT_LABS_FOOD_MESSAGE,
  },
};

const ApiMealIdParam = () =>
  ApiParam({
    name: 'id',
    description: 'The meal id, from `GET /admin/meals`.',
    example: MEAL.id,
  });

const ApiMenuWeekIdParam = () =>
  ApiParam({
    name: 'id',
    description: 'The weekly menu id, from `GET /admin/menu-weeks`.',
    example: MENU_WEEK.id,
  });

const WEEK_TAKEN = {
  description: '`MENU_WEEK_EXISTS`: this ISO week already has a menu.',
  example: { code: 'MENU_WEEK_EXISTS', message: 'This week already has a menu.' },
};

const MENU_WEEK_NOT_FOUND = {
  description: '`MENU_WEEK_NOT_FOUND`: no weekly menu with this id.',
  example: { code: 'MENU_WEEK_NOT_FOUND', message: 'Menu week not found.' },
};

const MEAL_NOT_LABS_FOOD = {
  description: "`CONTENT_NOT_OWNED`: one of `mealIds` is a batch cooker's dish.",
  example: {
    code: 'CONTENT_NOT_OWNED',
    message: "Only Lab's Food meals can go on a weekly menu.",
  },
};

/** Recettes §4.11: what keeps a Lab's Food meal from "Prête", as on a chef's dish. */
const withReadiness = (meal: Meal) => ({ ...meal, readiness: readiness(meal) });

@Controller()
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly users: UsersService,
  ) {}

  /** The admin's Postgres uuid: authorship records a person, not a Clerk subject. */
  private async adminId(user: ClerkUser): Promise<string> {
    const row = await this.users.findByClerkId(user.userId);
    return row!.id;
  }

  @Get('admin/meals')
  @ApiTags(TAGS.adminCatalog)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: "List Lab's Food meals",
    description:
      "Every Lab's Food meal, whatever its status, newest first. Not paginated.\n\n" +
      "Batch cookers' own dishes are not listed here, and these routes cannot change " +
      'them.',
  })
  @ApiOkResponse({
    description: 'The meals.',
    type: [MealResponseDto],
  })
  @ApiAdminAuthResponses()
  async listMeals() {
    return (await this.catalog.listMeals()).map(withReadiness);
  }

  @Post('admin/meals')
  @ApiTags(TAGS.adminCatalog)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Add a meal',
    description:
      "Adds a Lab's Food meal: no batch cooker owns it, and the admin is recorded as " +
      'its author (`createdByUserId`). Only `name` and `prepTime` are required. The ' +
      'meal starts as a `draft` unless ' +
      '`status` says otherwise. For a photo, upload the file to storage first and ' +
      'send its address in `imageUrl`.\n\n' +
      'Example: `{ "name": "Poulet yassa", "prepTime": 45, "continent": "africa" }`.',
  })
  @ApiCreatedResponse({ description: 'The new meal.', type: MealResponseDto })
  @ApiAdminAuthResponses()
  async createMeal(@Body() payload: CreateMealDto, @CurrentClerkUser() user: ClerkUser) {
    return withReadiness(
      await this.catalog.createMeal(payload, await this.adminId(user)),
    );
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
  @ApiNotFoundResponse({ description: 'No meal with this id.' })
  @ApiConflictResponse({
    description:
      '`OFFER_PENDING`: it is offered to a batch cooker; withdraw the offer first.',
  })
  @ApiForbiddenResponse(NOT_LABS_FOOD)
  @ApiAdminAuthResponses()
  async updateMeal(
    @Param('id') id: string,
    @Body() payload: UpdateMealDto,
    @CurrentClerkUser() user: ClerkUser,
  ) {
    return withReadiness(
      await this.catalog.updateMeal(id, payload, await this.adminId(user)),
    );
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
  @ApiForbiddenResponse(NOT_LABS_FOOD)
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
      'The menu is created unpublished (`publishedAt: null`).\n\n' +
      "Only Lab's Food meals can go on it: a batch cooker's dish is refused.",
  })
  @ApiCreatedResponse({
    description: 'The new weekly menu.',
    example: { ...MENU_WEEK, weekNumber: 40, publishedAt: null },
  })
  @ApiNotFoundResponse({ description: 'One of `mealIds` is not a meal.' })
  @ApiForbiddenResponse(MEAL_NOT_LABS_FOOD)
  @ApiConflictResponse(WEEK_TAKEN)
  @ApiAdminAuthResponses()
  createMenuWeek(@Body() payload: CreateMenuWeekDto) {
    return this.catalog.createMenuWeek(payload);
  }

  @Patch('admin/menu-weeks/:id')
  @ApiTags(TAGS.adminCatalog)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Change a weekly menu',
    description:
      'Corrects a menu already composed. Send only the fields to change. ' +
      '`mealIds` replaces the whole list of meals, it does not add to it: ' +
      '`{ "mealIds": [] }` empties the menu. `year` and `weekNumber` move it to ' +
      'another ISO week, if that week has no menu yet.\n\n' +
      "Same rule as on creation: only Lab's Food meals can go on it.",
  })
  @ApiMenuWeekIdParam()
  @ApiOkResponse({ description: 'The updated weekly menu.', example: MENU_WEEK })
  @ApiNotFoundResponse({
    description:
      '`MENU_WEEK_NOT_FOUND`: no weekly menu with this id. Also when one of ' +
      '`mealIds` is not a meal.',
    example: MENU_WEEK_NOT_FOUND.example,
  })
  @ApiForbiddenResponse(MEAL_NOT_LABS_FOOD)
  @ApiConflictResponse(WEEK_TAKEN)
  @ApiAdminAuthResponses()
  updateMenuWeek(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() payload: UpdateMenuWeekDto,
  ) {
    return this.catalog.updateMenuWeek(id, payload);
  }

  @Delete('admin/menu-weeks/:id')
  @ApiTags(TAGS.adminCatalog)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Delete a weekly menu',
    description:
      'Deletes the menu for good. Its meals stay in the catalog: only their place ' +
      'on this menu goes.',
  })
  @ApiMenuWeekIdParam()
  @ApiNoContentResponse({ description: 'Deleted. No body.' })
  @ApiNotFoundResponse(MENU_WEEK_NOT_FOUND)
  @ApiAdminAuthResponses()
  deleteMenuWeek(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.deleteMenuWeek(id);
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
