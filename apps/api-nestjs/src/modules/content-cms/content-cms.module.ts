import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ContentCmsController } from './content-cms.controller';
import { ContentCmsService } from './content-cms.service';
import { CmsPage } from '../../database/entities';

@Module({
  imports: [TypeOrmModule.forFeature([CmsPage])],
  controllers: [ContentCmsController],
  providers: [ContentCmsService],
})


export class ContentCmsModule {}
