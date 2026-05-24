import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard } from '../../auth/clerk-auth.guard';
import { CatalogService } from './catalog.service';
import { CreateMealDto, CreateMenuWeekDto, UpdateFormuleDto, UpdateMealDto } from './dto/catalog-admin.dto';

@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('menus/current')
  @ApiOkResponse({ description: "Current week's published menu." })
  getCurrentMenu() {
    return this.catalog.getCurrentPublishedMenu();
  }

  @Get('admin/meals')
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  listMeals() {
    return this.catalog.listMeals();
  }

  @Post('admin/meals')
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  createMeal(@Body() payload: CreateMealDto) {
    return this.catalog.createMeal(payload);
  }

  @Patch('admin/meals/:id')
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  updateMeal(@Param('id') id: string, @Body() payload: UpdateMealDto) {
    return this.catalog.updateMeal(id, payload);
  }

  @Get('admin/menu-weeks')
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  listMenuWeeks() {
    return this.catalog.listMenuWeeks();
  }

  @Post('admin/menu-weeks')
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  createMenuWeek(@Body() payload: CreateMenuWeekDto) {
    return this.catalog.createMenuWeek(payload);
  }

  @Get('admin/formules')
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  listFormules() {
    return this.catalog.listFormules();
  }

  @Patch('admin/formules/:id')
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  updateFormule(@Param('id') id: string, @Body() payload: UpdateFormuleDto) {
    return this.catalog.updateFormule(id, payload);
  }
}