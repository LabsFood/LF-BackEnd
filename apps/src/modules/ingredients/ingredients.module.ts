import { Module } from '@nestjs/common';

import { DishesModule } from '../dishes/dishes.module';
import { UsersModule } from '../users/users.module';
import { IngredientsController } from './ingredients.controller';
import { IngredientsService } from './ingredients.service';

/** Recettes §4.10: the common ingredient list. */
@Module({
  imports: [UsersModule, DishesModule],
  controllers: [IngredientsController],
  providers: [IngredientsService],
  exports: [IngredientsService],
})
export class IngredientsModule {}
