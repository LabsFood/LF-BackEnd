import { Module } from '@nestjs/common';

import { AvatarController } from './avatar.controller';
import { AvatarService } from './avatar.service';
import { PublicUsersController } from './public-users.controller';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [PublicUsersController, UsersController, AvatarController],
  providers: [UsersService, AvatarService],
  exports: [UsersService],
})
export class UsersModule {}
