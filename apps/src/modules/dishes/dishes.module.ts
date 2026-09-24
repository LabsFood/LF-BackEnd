import { Module } from '@nestjs/common';

import { ChefOnboardingModule } from '../chef-onboarding/chef-onboarding.module';
import { UsersModule } from '../users/users.module';
import { AdminContentController } from './admin-content.controller';
import { ChefContentService } from './chef-content.service';
import { DishesMailer } from './dishes.mailer';
import { DishesService } from './dishes.service';
import { LabsFoodContentService } from './labs-food-content.service';
import { MeContentController } from './me-content.controller';
import { MenusService } from './menus.service';
import { SuggestionsService } from './suggestions.service';

/** FLOW-02 — dishes, menus, publication and moderation. */
@Module({
  imports: [ChefOnboardingModule, UsersModule],
  controllers: [MeContentController, AdminContentController],
  providers: [
    ChefContentService,
    DishesService,
    DishesMailer,
    LabsFoodContentService,
    MenusService,
    SuggestionsService,
  ],
  // The legacy /admin/meals routes flag adopted copies when a suggestion changes.
  exports: [SuggestionsService],
})
export class DishesModule {}
