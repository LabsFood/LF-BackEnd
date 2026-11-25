import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { DishesModule } from '../dishes/dishes.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { ChefIngredientsService } from './chef-ingredients.service';
import { IngredientEnrichmentService } from './ingredient-enrichment.service';
import { IngredientImportService } from './ingredient-import.service';
import { IngredientPropagationService } from './ingredient-propagation.service';
import { IngredientsController } from './ingredients.controller';
import { IngredientsService } from './ingredients.service';
import { MeIngredientsController } from './me-ingredients.controller';

/**
 * Recettes §4.10: the common ingredient list. Recettes §7.3: a change to it is
 * carried into the recipes, their chefs told in the app and by e-mail.
 */
@Module({
  imports: [UsersModule, DishesModule, NotificationsModule, AiModule],
  controllers: [IngredientsController, MeIngredientsController],
  providers: [
    IngredientsService,
    ChefIngredientsService,
    IngredientPropagationService,
    IngredientImportService,
    IngredientEnrichmentService,
  ],
  exports: [IngredientsService, IngredientEnrichmentService],
})
export class IngredientsModule {}
