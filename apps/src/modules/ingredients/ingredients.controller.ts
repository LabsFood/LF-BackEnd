import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
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
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import {
  ApiAdminAuthResponses,
  ApiClerkAuthResponses,
} from '../../common/swagger/auth-responses';
import { TAGS } from '../../common/swagger/tags';
import { ChefContentService } from '../dishes/chef-content.service';
import { UsersService } from '../users/users.service';
import {
  AdoptIngredientDto,
  CatalogIngredientDto,
  ListCatalogIngredientsQueryDto,
  SearchIngredientsQueryDto,
  UpdateCatalogIngredientDto,
} from './dto/ingredient.dto';
import { ImportIngredientsDto } from './dto/import-ingredients.dto';
import { MergeIngredientDto } from './dto/merge-ingredient.dto';
import { IngredientEnrichmentService } from './ingredient-enrichment.service';
import { IngredientImportService } from './ingredient-import.service';
import { IngredientsService } from './ingredients.service';

const INGREDIENT_EXAMPLE = {
  id: '0d7c1c7a-3f5b-4d8e-9a1c-2b4e6f8a0c11',
  name: 'Tomate',
  aliases: ['pomme d’amour'],
  diets: ['vegetarian', 'vegan', 'no-pork', 'pescetarian', 'gluten-free', 'lactose-free'],
  seasonMonths: [6, 7, 8, 9],
  aisle: 'fruits-legumes',
  allergens: [],
  allergensNone: true,
  isBasic: false,
  status: 'active',
  private: false,
  reviewedAt: null,
  chef: null,
  carryPending: false,
  createdAt: '2026-11-02T09:00:00.000Z',
  updatedAt: '2026-11-02T09:00:00.000Z',
};

/** I1: what `GET /ingredients` answers, the public shape (`toPublic`) plus `private`. */
const SEARCH_EXAMPLE = {
  id: INGREDIENT_EXAMPLE.id,
  name: INGREDIENT_EXAMPLE.name,
  aliases: INGREDIENT_EXAMPLE.aliases,
  diets: INGREDIENT_EXAMPLE.diets,
  seasonMonths: INGREDIENT_EXAMPLE.seasonMonths,
  aisle: INGREDIENT_EXAMPLE.aisle,
  allergens: INGREDIENT_EXAMPLE.allergens,
  allergensNone: INGREDIENT_EXAMPLE.allergensNone,
  isBasic: INGREDIENT_EXAMPLE.isBasic,
  status: INGREDIENT_EXAMPLE.status,
  mergedInto: null,
  private: false,
  reviewedAt: INGREDIENT_EXAMPLE.reviewedAt,
  createdAt: INGREDIENT_EXAMPLE.createdAt,
  updatedAt: INGREDIENT_EXAMPLE.updatedAt,
};

const PROPAGATION_EXAMPLE = { dishes: 3, reverified: 2, chefs: 1, skipped: 0, failed: 0 };

const SEASON_REVIEW_EXAMPLE = {
  season: 'autumn',
  seasonStartsAt: '2026-08-31T22:00:00.000Z',
  reviewedAt: null,
  due: true,
  reason: 'never_reviewed',
};

const CHEF_INGREDIENT_EXAMPLE = {
  id: '5b2e8f1a-9c3d-4e7f-8a6b-1c2d3e4f5a6b',
  chefProfileId: '7f3c2a1b-4d5e-4f6a-9b8c-0d1e2f3a4b5c',
  catalogIngredientId: INGREDIENT_EXAMPLE.id,
  name: 'Tomate cœur de bœuf',
  aliases: [],
  diets: ['vegetarian', 'vegan'],
  seasonMonths: [7, 8],
  createdAt: '2026-11-10T09:00:00.000Z',
  updatedAt: '2026-11-10T09:00:00.000Z',
};

const reqId = (req: { id?: unknown }): string | undefined =>
  typeof req.id === 'string' ? req.id : undefined;

@Controller()
export class IngredientsController {
  constructor(
    private readonly ingredients: IngredientsService,
    private readonly users: UsersService,
    private readonly chefs: ChefContentService,
    private readonly importer: IngredientImportService,
    private readonly enrichment: IngredientEnrichmentService,
  ) {}

  @Get('ingredients')
  @ApiTags(TAGS.chefContent)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard)
  @ApiOperation({
    summary: 'Search the common ingredient list',
    description:
      'Recettes §4.10: up to 20 ingredients whose name contains `search` (accents ' +
      'ignored), or whose other name is exactly `search`. The common active entries, ' +
      'plus the caller’s own pending ones (`private: true`); never another chef’s. ' +
      'Each carries its aisle, allergens, `allergensNone`, `isBasic` and `status`, ' +
      'never a user id, the owner profile or the search key. A recipe line links one ' +
      'with `catalogIngredientId`.',
  })
  @ApiOkResponse({ description: 'The matches, by name.', example: [SEARCH_EXAMPLE] })
  @ApiClerkAuthResponses()
  async search(
    @CurrentClerkUser() user: ClerkUser,
    @Query() query: SearchIngredientsQueryDto,
  ) {
    // Recettes §4.10: an admin or a client has no chef profile (no throw): common entries only.
    const chefProfileId = await this.chefs.chefProfileIdOf(user.userId);
    return this.ingredients.search(query.search, chefProfileId);
  }

  @Get('admin/ingredients')
  @ApiTags(TAGS.adminCatalog)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'List the common ingredient list',
    description:
      'Recettes §5.1: every entry, private ones included, by name, paginated. `search` ' +
      'filters on a name or another name; `status`, `aisle`, `incomplete=true` (no aisle, ' +
      'or allergens neither listed nor "none"), `reviewed=true|false` and ' +
      '`carryPending=true|false` narrow it. Each entry carries `chef` (`{ id, ' +
      'displayName }` for a chef’s private entry, `null` for a common one) and, ruling ' +
      'R28, `carryPending`: true while a change of the entry is still to carry into the ' +
      'recipes (a run cut short, or dishes that failed), to replay with `POST ' +
      '/admin/ingredients/:id/propagate`. Both are also in the create, update, review, ' +
      'validate and merge answers. `seasonReview` says whether to remind the admin ' +
      '(BLK-33): `due` with `reason` `empty` (build the first list), `never_reviewed`, ' +
      'or `new_season` (a season started on 1 March, June, September or December, ' +
      'Paris time, since the last `POST /admin/ingredients/season-review`).',
  })
  @ApiOkResponse({
    description: '`{ data, meta, seasonReview }`.',
    example: {
      data: [INGREDIENT_EXAMPLE],
      meta: { page: 1, limit: 20, total: 1 },
      seasonReview: SEASON_REVIEW_EXAMPLE,
    },
  })
  @ApiAdminAuthResponses()
  list(@Query() query: ListCatalogIngredientsQueryDto) {
    return this.ingredients.list(query);
  }

  @Post('admin/ingredients/import')
  @HttpCode(200)
  @ApiTags(TAGS.adminCatalog)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Import the common list from a CSV',
    description:
      'Recettes §7.4: `csv` (500,000 characters, 2,000 lines at most) with the header `nom;autres_noms;' +
      'rayon;allergenes;aucun_allergene;regimes;mois;base;doute`, separator `;`, lists ' +
      'separated by `|`, booleans `oui`/`non`, `doute` ignored. Without `confirm: true` ' +
      'it only simulates: `created`, `updated`, `unchanged` and the `errors` per line ' +
      '(`line` 1 is the header). It writes nothing while there is an error. Confirmed, ' +
      'it matches each row by its normalized name (a lot 2 entry whose key is still ' +
      'empty, by its name normalized by the API): a new name is created (common, ' +
      'active), a changed entry is updated and carried into the recipes (§7.3, the ' +
      'figures summed in `propagation`; `updatedIds` lists the entries updated ' +
      '(empty in a simulation), to replay `failed` dishes with `POST ' +
      '/admin/ingredients/:id/propagate` for each), an identical one is left. A chef ' +
      'whose dishes lose their verification gets one e-mail for the whole import ' +
      '(`propagation.chefs` counts them once). Row by row: if a ' +
      'write fails the run stops with that error (`line: 0`), and the same file can be ' +
      'sent again. Recorded in the audit log.',
  })
  @ApiOkResponse({
    description: 'The report of the simulation or of the import.',
    example: {
      created: 280,
      updated: 12,
      unchanged: 8,
      errors: [{ line: 14, message: 'rayon: « cave » n’est pas dans la liste.' }],
      updatedIds: ['0d7c1c7a-3f5b-4d8e-9a1c-2b4e6f8a0c11'],
      propagation: PROPAGATION_EXAMPLE,
    },
  })
  @ApiAdminAuthResponses()
  async import(@CurrentClerkUser() user: ClerkUser, @Body() body: ImportIngredientsDto) {
    return this.importer.run(
      body.csv,
      { confirm: body.confirm === true },
      await this.adminId(user),
    );
  }

  @Post('admin/ingredients')
  @ApiTags(TAGS.adminCatalog)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Add an ingredient to the common list',
    description:
      'Name, up to 20 other names, the diets it suits (implied ones are added), months ' +
      'in season, aisle (a code of the list in force), allergens or `allergensNone`, and ' +
      '`isBasic`. `422` for an unknown aisle, or allergens together with ' +
      '`allergensNone`. `409 INGREDIENT_ALREADY_LISTED` (with the existing `{ id, name }`) ' +
      'when the name exists, whatever the case or accents. Recorded in the audit log.',
  })
  @ApiCreatedResponse({ description: 'The ingredient.', example: INGREDIENT_EXAMPLE })
  @ApiConflictResponse({
    description: 'The name is already in the list.',
    example: {
      code: 'INGREDIENT_ALREADY_LISTED',
      message: 'An ingredient of this name is already in the list.',
      ingredient: { id: INGREDIENT_EXAMPLE.id, name: 'Tomate' },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Unknown aisle, or allergens together with `allergensNone`.',
  })
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
      'Only the fields sent change. `status` is `active` or `inactive`, for a common ' +
      'entry only (`422` on a chef’s private one). Recettes §7.3: a change to the name, ' +
      'aisle, allergens, `allergensNone`, diets or months is carried into every recipe ' +
      'linking it (lines re-stamped, allergens and classification recomputed). A ' +
      'verified dish whose allergens change loses its verification: it stays published ' +
      'but cannot be booked, and its chef is notified and e-mailed. See ' +
      '`GET /admin/ingredients/:id/impact` first; `POST /admin/ingredients/:id/propagate` ' +
      'replays the propagation. Ruling R28: such a change marks the entry ' +
      '`carryPending` in the same transaction, and only a carry or a replay ending with ' +
      'no `failed` dish clears it, so a run cut short stays visible. Recorded in the ' +
      'audit log.',
  })
  @ApiOkResponse({
    description:
      '`{ ingredient, propagation }`: `propagation` holds the figures of what was ' +
      'carried (`failed` dishes can be replayed with `POST ' +
      '/admin/ingredients/:id/propagate`), and is null when nothing was carried. ' +
      '`ingredient.carryPending` is as the carry left it: true when dishes failed.',
    example: { ingredient: INGREDIENT_EXAMPLE, propagation: PROPAGATION_EXAMPLE },
  })
  @ApiNotFoundResponse({ description: 'No such ingredient.' })
  @ApiConflictResponse({ description: 'The new name is already in the list.' })
  @ApiUnprocessableEntityResponse({
    description:
      'Unknown aisle, allergens together with `allergensNone`, or a status on a private entry.',
  })
  @ApiAdminAuthResponses()
  async update(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCatalogIngredientDto,
  ) {
    return this.ingredients.update(id, body, await this.adminId(user));
  }

  @Get('admin/ingredients/:id/impact')
  @ApiTags(TAGS.adminCatalog)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'See what a change to an ingredient would touch',
    description:
      'Recettes §7.2: before saving a change to allergens, diets or months, the number ' +
      'of dishes linking the ingredient (Lab’s Food recipes included), of chefs owning ' +
      'them, and of verified dishes, which lose their verification if the allergens ' +
      'change. Reads only.',
  })
  @ApiOkResponse({
    description: 'The counts.',
    example: { dishes: 12, chefs: 5, verifiedDishes: 9 },
  })
  @ApiNotFoundResponse({ description: 'No such ingredient.' })
  @ApiAdminAuthResponses()
  impact(@Param('id', ParseUUIDPipe) id: string) {
    return this.ingredients.impact(id);
  }

  @Get('admin/ingredients/:id/dishes')
  @ApiTags(TAGS.adminCatalog)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'List the dishes linking an ingredient',
    description:
      'Ruling R25: the dishes whose lines link the ingredient, or an ingredient merged ' +
      'into it, by name, 200 at most (`total` counts them all). Each carries its ' +
      '`status`, `allergensVerifiedAt` and `chef` (`{ id, displayName }`, `null` for a ' +
      'Lab’s Food recipe). Reads only.',
  })
  @ApiOkResponse({
    description: '`{ data, total }`.',
    example: {
      data: [
        {
          id: '5b1e7c2a-8d3f-4a6b-9c0d-1e2f3a4b5c6d',
          name: 'Curry de légumes',
          chef: { id: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', displayName: 'Chez Marie' },
          status: 'published',
          allergensVerifiedAt: '2026-11-02T09:00:00.000Z',
        },
      ],
      total: 1,
    },
  })
  @ApiNotFoundResponse({ description: 'No such ingredient.' })
  @ApiAdminAuthResponses()
  dishes(@Param('id', ParseUUIDPipe) id: string) {
    return this.ingredients.dishes(id);
  }

  @Post('admin/ingredients/:id/propagate')
  @HttpCode(200)
  @ApiTags(TAGS.adminCatalog)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Carry an ingredient into its recipes again',
    description:
      'Recettes §7.3, ruling R14: replays what a change to the ingredient does to every ' +
      'recipe linking it, for a run cut short or dishes that `failed`. Idempotent: a ' +
      'dish already stamped from the ingredient as it stands is not written again, and ' +
      'no chef is notified or e-mailed twice. Answers the figures of this run: dishes ' +
      'rewritten, verifications cleared, chefs told, dishes `skipped` because a save ' +
      'in between already composed them from the ingredient as it stands, and dishes ' +
      '`failed`: an error, or saves in between that left them stale. Replay again for ' +
      'those. Ruling R28: a run with no `failed` dish clears `carryPending` on the ' +
      'ingredient and on the ingredients merged into it. Nothing replays at boot. ' +
      'Recorded in the audit log.',
  })
  @ApiOkResponse({
    description: 'The figures of this run.',
    example: { dishes: 3, reverified: 2, chefs: 1, skipped: 0, failed: 0 },
  })
  @ApiNotFoundResponse({ description: 'No such ingredient.' })
  @ApiAdminAuthResponses()
  async propagate(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ingredients.propagate(id, await this.adminId(user));
  }

  @Post('admin/ingredients/:id/review')
  @HttpCode(200)
  @ApiTags(TAGS.adminCatalog)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Mark an ingredient as reviewed',
    description:
      'Recettes §5.1: the admin has checked its aisle and allergens. Sets `reviewedAt` ' +
      'and the reviewer. Recorded in the audit log.',
  })
  @ApiOkResponse({ description: 'The ingredient.', example: INGREDIENT_EXAMPLE })
  @ApiNotFoundResponse({ description: 'No such ingredient.' })
  @ApiAdminAuthResponses()
  async review(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ingredients.review(id, await this.adminId(user));
  }

  @Post('admin/ingredients/:id/validate')
  @HttpCode(200)
  @ApiTags(TAGS.adminCatalog)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Validate a chef’s ingredient',
    description:
      'Recettes §7.2: a `pending` ingredient joins the common list (`status: active`, ' +
      'no longer private, `reviewedAt` set). Correct it first with `PATCH ' +
      '/admin/ingredients/:id` if needed. Its author is notified ' +
      '(`ingredient_validated`). Nothing a recipe copies changes, so `propagation` is ' +
      'null. `409 INGREDIENT_ALREADY_LISTED` (with the existing `{ id, name }`) when a ' +
      'common ingredient already has the name: merge instead. `422` when it is not ' +
      'pending. Recorded in the audit log.',
  })
  @ApiOkResponse({
    description: '`{ ingredient, propagation }`.',
    example: {
      ingredient: { ...INGREDIENT_EXAMPLE, reviewedAt: '2026-11-04T09:00:00.000Z' },
      propagation: null,
    },
  })
  @ApiNotFoundResponse({ description: 'No such ingredient.' })
  @ApiConflictResponse({
    description: 'A common ingredient already has this name.',
    example: {
      code: 'INGREDIENT_ALREADY_LISTED',
      message: 'An ingredient of this name is already in the list.',
      ingredient: { id: INGREDIENT_EXAMPLE.id, name: 'Tomate' },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: '`INGREDIENT_NOT_PENDING`: only a chef’s pending ingredient.',
  })
  @ApiAdminAuthResponses()
  async validate(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ingredients.validate(id, await this.adminId(user));
  }

  @Post('admin/ingredients/:id/merge')
  @HttpCode(200)
  @ApiTags(TAGS.adminCatalog)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Merge a chef’s ingredient into a common one',
    description:
      'Recettes §7.2: a `pending` ingredient becomes `merged` into the common, active ' +
      'ingredient `intoId`. Recipe lines linking it link the target instead, ' +
      're-stamped like any propagation (§7.3). Its author is notified ' +
      '(`ingredient_merged`). `422` when the source is not pending, or the target is ' +
      'not a common active ingredient. Recorded in the audit log.',
  })
  @ApiOkResponse({
    description:
      '`{ ingredient, propagation }`: the figures of the carry; replay `failed` dishes ' +
      'with `POST /admin/ingredients/:id/propagate`, on this ingredient or the target. ' +
      'The merged ingredient stays `carryPending` (ruling R28) until a carry of its ' +
      'lines ends with no failed dish.',
    example: {
      ingredient: { ...INGREDIENT_EXAMPLE, status: 'merged' },
      propagation: PROPAGATION_EXAMPLE,
    },
  })
  @ApiNotFoundResponse({ description: 'No such ingredient.' })
  @ApiUnprocessableEntityResponse({
    description:
      '`INGREDIENT_NOT_PENDING`, or `INGREDIENT_MERGE_TARGET_INVALID`: the target is ' +
      'unknown, private, inactive, merged or pending.',
  })
  @ApiAdminAuthResponses()
  async merge(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: MergeIngredientDto,
  ) {
    return this.ingredients.merge(id, body.intoId, await this.adminId(user));
  }

  @Post('admin/ingredients/complete-with-ai')
  @HttpCode(200)
  @ApiTags(TAGS.adminCatalog)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Fill the empty fields of incomplete entries with AI',
    description:
      'Recettes §5.1: up to 20 common entries without an aisle, or with allergens ' +
      'neither listed nor "none", get their EMPTY fields (aisle, allergens or "none", ' +
      'diets when empty) from the AI (`recettes` / `fiche_ingredient` budget). A field ' +
      'already filled is never changed. Each write goes through the admin update, so it ' +
      'is carried into the recipes (§7.3), chefs e-mailed once for the call. Entries ' +
      'stay unreviewed. `remaining` counts the incomplete entries left: call again ' +
      'until it is 0. Recorded in the audit log.',
  })
  @ApiOkResponse({
    description: 'What this call completed.',
    example: { completed: 18, failed: [], remaining: 182, costMicroEur: 900 },
  })
  @ApiAdminAuthResponses()
  async completeWithAi(@CurrentClerkUser() user: ClerkUser) {
    return this.enrichment.completeIncomplete(await this.adminId(user));
  }

  @Post('admin/ingredients/season-review')
  @HttpCode(200)
  @ApiTags(TAGS.adminCatalog)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Confirm the ingredient list fits the season',
    description:
      'BLK-33: clears the season reminder until the next season starts. Changing ' +
      'entries does not clear it by itself. Recorded in the audit log.',
  })
  @ApiOkResponse({
    description: 'The reminder, now off.',
    example: {
      ...SEASON_REVIEW_EXAMPLE,
      reviewedAt: '2026-11-10T09:00:00.000Z',
      due: false,
      reason: null,
    },
  })
  @ApiAdminAuthResponses()
  async seasonReviewed(
    @CurrentClerkUser() user: ClerkUser,
    @Req() req: { id?: unknown },
  ) {
    return this.ingredients.markSeasonReviewed(await this.adminId(user), reqId(req));
  }

  @Get('me/chef/ingredients')
  @ApiTags(TAGS.chefContent)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard)
  @ApiOperation({
    summary: 'List my own ingredients',
    description:
      'BLK-33: the entries of the common list I adopted, in my version, by name (500 ' +
      'at most). My dishes are classified from these; the rest from the common list. ' +
      '`NOT_A_CHEF`, `CHEF_NOT_VERIFIED`.',
  })
  @ApiOkResponse({ description: 'My versions.', example: [CHEF_INGREDIENT_EXAMPLE] })
  @ApiClerkAuthResponses()
  async listMine(@CurrentClerkUser() user: ClerkUser) {
    const chef = await this.users.chefIdentity(user.userId);
    return this.ingredients.listMine(chef.chefProfileId);
  }

  @Post('me/chef/ingredients')
  @ApiTags(TAGS.chefContent)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard)
  @ApiOperation({
    summary: 'Adopt an ingredient of the common list',
    description:
      'Copies the entry into my list, to edit with `PATCH /me/chef/ingredients/{id}`. ' +
      'Adopting it again returns my version unchanged. `404 INGREDIENT_NOT_FOUND`, ' +
      '`422 CHEF_INGREDIENTS_LIMIT` past 500.',
  })
  @ApiCreatedResponse({ description: 'My version.', example: CHEF_INGREDIENT_EXAMPLE })
  @ApiNotFoundResponse({ description: 'No such entry in the common list.' })
  @ApiUnprocessableEntityResponse({ description: 'Already 500 ingredients of my own.' })
  @ApiClerkAuthResponses()
  async adopt(@CurrentClerkUser() user: ClerkUser, @Body() body: AdoptIngredientDto) {
    const chef = await this.users.chefIdentity(user.userId);
    return this.ingredients.adopt(chef.chefProfileId, body.catalogIngredientId);
  }

  @Patch('me/chef/ingredients/:id')
  @ApiTags(TAGS.chefContent)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard)
  @ApiOperation({
    summary: 'Edit my version of an ingredient',
    description:
      'Only the fields sent change. My dishes that link it are classified again from ' +
      'my version. `404 CHEF_INGREDIENT_NOT_FOUND` for an id not in my list.',
  })
  @ApiOkResponse({ description: 'My version.', example: CHEF_INGREDIENT_EXAMPLE })
  @ApiNotFoundResponse({ description: 'Not in my list.' })
  @ApiClerkAuthResponses()
  async updateMine(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCatalogIngredientDto,
  ) {
    const chef = await this.users.chefIdentity(user.userId);
    return this.ingredients.updateMine(chef.chefProfileId, id, body);
  }

  @Delete('me/chef/ingredients/:id')
  @HttpCode(204)
  @ApiTags(TAGS.chefContent)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard)
  @ApiOperation({
    summary: 'Go back to the common version of an ingredient',
    description:
      'Removes my version: my dishes that link it are classified from the common list ' +
      'again. `404 CHEF_INGREDIENT_NOT_FOUND`.',
  })
  @ApiNoContentResponse({ description: 'Removed.' })
  @ApiNotFoundResponse({ description: 'Not in my list.' })
  @ApiClerkAuthResponses()
  async removeMine(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    const chef = await this.users.chefIdentity(user.userId);
    await this.ingredients.removeMine(chef.chefProfileId, id);
  }

  /** The admin's Postgres id: the audit log records a person. */
  private async adminId(user: ClerkUser) {
    const admin =
      (await this.users.findByClerkId(user.userId)) ??
      (await this.users.ensurePersistedFromClerk(user.userId));
    return admin.id;
  }
}
