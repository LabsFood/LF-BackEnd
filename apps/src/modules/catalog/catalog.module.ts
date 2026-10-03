import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { DishesModule } from '../dishes/dishes.module';
import { UsersModule } from '../users/users.module';

import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({
  imports: [AuthModule, UsersModule, DishesModule],
  controllers: [CatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}
