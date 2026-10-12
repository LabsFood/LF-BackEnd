import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Logger,
  Post,
  Req,
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

import type { FastifyRequest } from 'fastify';

import { ApiAdminAuthResponses } from '../../common/swagger/auth-responses';
import { TAGS } from '../../common/swagger/tags';
import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
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
  ingredients: [{ name: 'Cuisses de poulet', qty: 8, unit: 'pièce', aisle: 'boucherie' }],
  steps: ['Mariner le poulet', 'Faire revenir les oignons'],
  reheating: { mode: 'oven', temperature: 160, minutes: 15, note: null },
  storage: { method: 'fridge', days: 3, container: null },
  publishedAt: '2026-09-03T14:12:00.000Z',
  isFeatured: true,
  status: 'published',
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-03T14:12:00.000Z',
};

/** What public routes show of a meal: everything but the recipe. */
const {
  ingredients: _ingredients,
  steps: _steps,
  reheating: _reheating,
  storage: _storage,
  ...PUBLIC_MEAL
} = MEAL;

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

@Controller()
export class CatalogController {
  private readonly logger = new Logger(CatalogController.name);

  constructor(
    private readonly catalog: CatalogService,
    private readonly users: UsersService,
  ) {}

  /** The admin's Postgres uuid: authorship records a person, not a Clerk subject. */
  private async adminId(user: ClerkUser): Promise<string> {
    const row = await this.users.findByClerkId(user.userId);
    return row!.id;
  }

  @Get('menus/current')
  @ApiTags(TAGS.catalog)
  @ApiOperation({
    deprecated: true,
    summary: 'Get the menu of the week (deprecated)',
    description:
      '**Deprecated**: use `GET /menus/week`, which lists the week’s cooks and their ' +
      'menus. Every call is logged, so any remaining caller shows up before this ' +
      'route is removed.\n\n' +
      'The most recent weekly menu that has been published, with its meals. `meals` ' +
      'is the list to show; `menuWeek` says which week it is. Public: no token needed.\n\n' +
      "Lab's Food meals only, and never their recipe: `ingredients`, `steps`, " +
      '`reheating` and `storage` are left out.\n\n' +
      'Answers `200` with an empty body when no menu has been published yet.',
  })
  @ApiOkResponse({
    description: 'The week and its meals.',
    example: {
      menuWeek: {
        ...MENU_WEEK,
        meals: [{ ...MENU_WEEK.meals[0], meal: PUBLIC_MEAL }],
      },
      meals: [PUBLIC_MEAL],
    },
  })
  getCurrentMenu(@Req() request: FastifyRequest) {
    // FLOW-02: logged so a consumer outside the two frontends surfaces in Railway.
    this.logger.warn(
      `Deprecated GET /menus/current called by ${loggable(request.headers['user-agent'])}` +
        ` from ${loggable(request.headers.origin ?? request.headers.referer)}`,
    );
    return this.catalog.getCurrentPublishedMenu();
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
    return this.catalog.createMeal(payload, await this.adminId(user));
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
    return this.catalog.updateMeal(id, payload, await this.adminId(user));
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
      'The menu is created unpublished (`publishedAt: null`), and no route publishes ' +
      'it yet, so it will not appear in `GET /menus/current`.\n\n' +
      "Only Lab's Food meals can go on it: a batch cooker's dish is refused.",
  })
  @ApiCreatedResponse({
    description: 'The new weekly menu.',
    example: { ...MENU_WEEK, weekNumber: 40, publishedAt: null },
  })
  @ApiNotFoundResponse({ description: 'One of `mealIds` is not a meal.' })
  @ApiForbiddenResponse({
    description: "`CONTENT_NOT_OWNED`: one of `mealIds` is a batch cooker's dish.",
    example: {
      code: 'CONTENT_NOT_OWNED',
      message: "Only Lab's Food meals can go on a weekly menu.",
    },
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

/** A header as it may go into a log line: one line, bounded, never forged. */
function loggable(value: string | string[] | undefined): string {
  const text = Array.isArray(value) ? value.join(', ') : value;
  return text ? text.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200) : 'unknown';
}
