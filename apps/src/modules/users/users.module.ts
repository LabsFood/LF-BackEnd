import { Module } from '@nestjs/common';

import { ChefPhotoController } from './chef-photo.controller';
import { ChefPhotoService } from './chef-photo.service';
import { PublicUsersController } from './public-users.controller';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [PublicUsersController, UsersController, ChefPhotoController],
  providers: [UsersService, ChefPhotoService],
  exports: [UsersService],
})
export class UsersModule {}
