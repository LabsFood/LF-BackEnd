import { Module } from '@nestjs/common';

import { ChefOnboardingModule } from '../chef-onboarding/chef-onboarding.module';
import { ShoppingListsModule } from '../shopping-lists/shopping-lists.module';
import { UsersModule } from '../users/users.module';
import { AdminContentController } from './admin-content.controller';
import { AdminModerationController } from './admin-moderation.controller';
import { ChefContentService } from './chef-content.service';
import { DishPhotosService } from './dish-photos.service';
import { DishesMailer } from './dishes.mailer';
import { DishesService } from './dishes.service';
import { LabsFoodContentService } from './labs-food-content.service';
import { MeContentController } from './me-content.controller';
import { MenusService } from './menus.service';
import { MissionsController } from './missions.controller';
import { MissionsService } from './missions.service';
import { ModerationService } from './moderation.service';
import { PublicVitrineController } from './public-vitrine.controller';
import { SuggestionsService } from './suggestions.service';
import { VitrineService } from './vitrine.service';

/** FLOW-02 — dishes, menus, publication and moderation. */
@Module({
  imports: [ChefOnboardingModule, UsersModule, ShoppingListsModule],
  controllers: [
    MeContentController,
    AdminContentController,
    AdminModerationController,
    MissionsController,
    PublicVitrineController,
  ],
  providers: [
    ChefContentService,
    DishPhotosService,
    DishesService,
    DishesMailer,
    LabsFoodContentService,
    MenusService,
    MissionsService,
    ModerationService,
    SuggestionsService,
    VitrineService,
  ],
  // The legacy /admin/meals routes flag adopted copies when a suggestion changes.
  exports: [SuggestionsService],
})
export class DishesModule {}
