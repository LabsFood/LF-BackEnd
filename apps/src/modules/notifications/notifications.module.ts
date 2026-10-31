import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/** The in-app bell (Recettes §12). Exported for the lots that alert someone. */
@Module({
  imports: [UsersModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
