import { Module } from '@nestjs/common';

import { AccountDeletionController } from './account-deletion.controller';
import { AccountDeletionService } from './account-deletion.service';
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
    AccountDeletionController,
  ],
  providers: [UsersService, AvatarService, AdminChefsService, AccountDeletionService],
  exports: [UsersService],
})
export class UsersModule {}
