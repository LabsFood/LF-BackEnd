import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { IngredientsController } from './ingredients.controller';
import { IngredientsService } from './ingredients.service';

/** Recettes §4.10: the common ingredient list. */
@Module({
  imports: [UsersModule],
  controllers: [IngredientsController],
  providers: [IngredientsService],
  exports: [IngredientsService],
})
export class IngredientsModule {}
