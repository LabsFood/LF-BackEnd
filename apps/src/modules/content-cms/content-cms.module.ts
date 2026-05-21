import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CmsPage } from '../../supabase/entities';
import { UsersModule } from '../users/users.module';
import { ContentCmsController } from './content-cms.controller';
import { ContentCmsService } from './content-cms.service';

@Module({
  imports: [TypeOrmModule.forFeature([CmsPage]), UsersModule],
  controllers: [ContentCmsController],
  providers: [ContentCmsService],
  exports: [ContentCmsService],
})
export class ContentCmsModule {}
