import { Module } from '@nestjs/common';

import { ChefOnboardingModule } from '../chef-onboarding/chef-onboarding.module';
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
import { ModerationService } from './moderation.service';
import { PublicVitrineController } from './public-vitrine.controller';
import { R2StorageService } from './r2-storage.service';
import { SuggestionsService } from './suggestions.service';
import { VitrineService } from './vitrine.service';

/** FLOW-02 — dishes, menus, publication and moderation. */
@Module({
  imports: [ChefOnboardingModule, UsersModule],
  controllers: [
    MeContentController,
    AdminContentController,
    AdminModerationController,
    PublicVitrineController,
  ],
  providers: [
    ChefContentService,
    DishPhotosService,
    DishesService,
    DishesMailer,
    LabsFoodContentService,
    MenusService,
    ModerationService,
    R2StorageService,
    SuggestionsService,
    VitrineService,
  ],
  // The legacy /admin/meals routes flag adopted copies when a suggestion changes.
  exports: [SuggestionsService],
})
export class DishesModule {}
