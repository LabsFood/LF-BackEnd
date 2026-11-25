import { Module } from '@nestjs/common';

import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { AllergiesController } from './allergies.controller';
import { AllergiesService } from './allergies.service';

/** The client's allergies and consent (Recettes lot 1). The rules live in `domain/`. */
@Module({
  imports: [UsersModule, NotificationsModule],
  controllers: [AllergiesController],
  providers: [AllergiesService],
})
export class AllergiesModule {}
