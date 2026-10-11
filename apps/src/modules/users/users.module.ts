import { Module } from '@nestjs/common';

import { AdminChefsController } from './admin-chefs.controller';
import { AdminChefsService } from './admin-chefs.service';
import { AvatarController } from './avatar.controller';
import { AvatarService } from './avatar.service';
import { PublicUsersController } from './public-users.controller';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [
    PublicUsersController,
    UsersController,
    AvatarController,
    AdminChefsController,
  ],
  providers: [UsersService, AvatarService, AdminChefsService],
  exports: [UsersService],
})
export class UsersModule {}
