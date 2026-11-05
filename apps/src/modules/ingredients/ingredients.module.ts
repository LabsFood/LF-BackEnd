import { Module } from '@nestjs/common';

import { DishesModule } from '../dishes/dishes.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { IngredientPropagationService } from './ingredient-propagation.service';
import { IngredientsController } from './ingredients.controller';
import { IngredientsService } from './ingredients.service';

/**
 * Recettes §4.10: the common ingredient list. Recettes §7.3: a change to it is
 * carried into the recipes, their chefs told in the app and by e-mail.
 */
@Module({
  imports: [UsersModule, DishesModule, NotificationsModule],
  controllers: [IngredientsController],
  providers: [IngredientsService, IngredientPropagationService],
  exports: [IngredientsService],
})
export class IngredientsModule {}
