import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { PlatformSettingsController } from './platform-settings.controller';
import { PlatformSettingsService } from './platform-settings.service';

/** Settings an admin changes without a deploy: the commission, to begin with. */
@Module({
  imports: [UsersModule],
  controllers: [PlatformSettingsController],
  providers: [PlatformSettingsService],
  exports: [PlatformSettingsService],
})
export class PlatformSettingsModule {}
