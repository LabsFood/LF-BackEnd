import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { DishesModule } from '../dishes/dishes.module';
import { UsersModule } from '../users/users.module';
import { RecipeImportController } from './recipe-import.controller';
import { RecipeImportService } from './recipe-import.service';
import { RecipeImportStorageService } from './recipe-import-storage.service';

/** Import de recettes par IA (DAT §4) : sources, traitement, brouillons. */
@Module({
  imports: [AiModule, DishesModule, UsersModule],
  controllers: [RecipeImportController],
  providers: [RecipeImportService, RecipeImportStorageService],
})
export class RecipeImportModule {}
