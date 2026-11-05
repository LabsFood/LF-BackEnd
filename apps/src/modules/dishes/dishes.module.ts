import { Module } from '@nestjs/common';

import { CalendarModule } from '../calendar/calendar.module';
import { ChefOnboardingModule } from '../chef-onboarding/chef-onboarding.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ShoppingListsModule } from '../shopping-lists/shopping-lists.module';
import { UsersModule } from '../users/users.module';
import { AdminContentController } from './admin-content.controller';
import { AdminModerationController } from './admin-moderation.controller';
import { ChefContentService } from './chef-content.service';
import { ContentPhotosService } from './content-photos.service';
import { DishesMailer } from './dishes.mailer';
import { DishesService } from './dishes.service';
import { DuplicationService } from './duplication.service';
import { LabsFoodContentService } from './labs-food-content.service';
import { MeContentController } from './me-content.controller';
import { MenusService } from './menus.service';
import { MissionsController } from './missions.controller';
import { MissionsService } from './missions.service';
import { ModerationService } from './moderation.service';
import { RecipeVersionsService } from './recipe-versions.service';
import { PublicVitrineController } from './public-vitrine.controller';
import { SuggestionsService } from './suggestions.service';
import { VitrineService } from './vitrine.service';

/** FLOW-02 — dishes, menus, publication and moderation. */
@Module({
  imports: [
    ChefOnboardingModule,
    UsersModule,
    ShoppingListsModule,
    CalendarModule,
    NotificationsModule,
  ],
  controllers: [
    MeContentController,
    AdminContentController,
    AdminModerationController,
    MissionsController,
    PublicVitrineController,
  ],
  providers: [
    ChefContentService,
    ContentPhotosService,
    DishesService,
    DishesMailer,
    DuplicationService,
    LabsFoodContentService,
    MenusService,
    MissionsService,
    ModerationService,
    RecipeVersionsService,
    SuggestionsService,
    VitrineService,
  ],
  // The legacy /admin/meals routes flag adopted copies when a suggestion changes.
  exports: [SuggestionsService],
})
export class DishesModule {}
