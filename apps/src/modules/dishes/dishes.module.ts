import { Module } from '@nestjs/common';

import { ChefOnboardingModule } from '../chef-onboarding/chef-onboarding.module';
import { ChefContentService } from './chef-content.service';
import { DishesService } from './dishes.service';
import { MeContentController } from './me-content.controller';
import { MenusService } from './menus.service';

/** FLOW-02 — dishes, menus, publication and moderation. */
@Module({
  imports: [ChefOnboardingModule],
  controllers: [MeContentController],
  providers: [ChefContentService, DishesService, MenusService],
})
export class DishesModule {}
