import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { ApiAdminAuthResponses } from '../../common/swagger/auth-responses';
import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard } from '../../auth/clerk-auth.guard';
import { CatalogService } from './catalog.service';
import {
  CreateMealDto,
  CreateMenuWeekDto,
  UpdateFormuleDto,
  UpdateMealDto,
} from './dto/catalog-admin.dto';

@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('menus/current')
  @ApiOperation({
    summary: 'Get the current published weekly menu',
    description:
      'Public endpoint. Returns the menu published for the current calendar week, ' +
      'including linked meals. No authentication required.',
  })
  @ApiOkResponse({ description: 'Published menu week with meal details.' })
  getCurrentMenu() {
    return this.catalog.getCurrentPublishedMenu();
  }

  @Get('admin/meals')
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Admin: list all meals',
    description: 'Returns every meal in the catalog (draft and published).',
  })
  @ApiOkResponse({ description: 'Array of meal records.' })
  @ApiAdminAuthResponses()
  listMeals() {
    return this.catalog.listMeals();
  }

  @Post('admin/meals')
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Admin: create a meal',
    description: 'Adds a new meal to the catalog. Defaults to `draft` status when omitted.',
  })
  @ApiOkResponse({ description: 'Created meal record.' })
  @ApiAdminAuthResponses()
  createMeal(@Body() payload: CreateMealDto) {
    return this.catalog.createMeal(payload);
  }

  @Patch('admin/meals/:id')
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Admin: update a meal',
    description: 'Partial update of name, prep time, allergens, ingredients, or status.',
  })
  @ApiParam({ name: 'id', description: 'Meal uuid.', format: 'uuid' })
  @ApiOkResponse({ description: 'Updated meal record.' })
  @ApiAdminAuthResponses()
  updateMeal(@Param('id') id: string, @Body() payload: UpdateMealDto) {
    return this.catalog.updateMeal(id, payload);
  }

  @Get('admin/menu-weeks')
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Admin: list menu weeks',
    description: 'Returns all configured weekly menus with publication status.',
  })
  @ApiOkResponse({ description: 'Array of menu week records.' })
  @ApiAdminAuthResponses()
  listMenuWeeks() {
    return this.catalog.listMenuWeeks();
  }

  @Post('admin/menu-weeks')
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Admin: create a menu week',
    description:
      'Defines a weekly menu for a given ISO year/week number and attaches meal ids.',
  })
  @ApiOkResponse({ description: 'Created menu week record.' })
  @ApiAdminAuthResponses()
  createMenuWeek(@Body() payload: CreateMenuWeekDto) {
    return this.catalog.createMenuWeek(payload);
  }

  @Get('admin/formules')
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Admin: list pricing formules',
    description: 'Returns subscription / package formules with prices and feature lists.',
  })
  @ApiOkResponse({ description: 'Array of formule records.' })
  @ApiAdminAuthResponses()
  listFormules() {
    return this.catalog.listFormules();
  }

  @Patch('admin/formules/:id')
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Admin: update a formule',
    description: 'Patches name, prices, features, or active flag on a pricing formule.',
  })
  @ApiParam({ name: 'id', description: 'Formule id.', example: 'demo-seed-f01' })
  @ApiOkResponse({ description: 'Updated formule record.' })
  @ApiAdminAuthResponses()
  updateFormule(@Param('id') id: string, @Body() payload: UpdateFormuleDto) {
    return this.catalog.updateFormule(id, payload);
  }
}
