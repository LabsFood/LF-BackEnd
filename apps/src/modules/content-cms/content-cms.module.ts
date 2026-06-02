import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { ContentCmsController } from './content-cms.controller';
import { ContentCmsService } from './content-cms.service';

@Module({
  imports: [UsersModule],
  controllers: [ContentCmsController],
  providers: [ContentCmsService],
})
export class ContentCmsModule {}
