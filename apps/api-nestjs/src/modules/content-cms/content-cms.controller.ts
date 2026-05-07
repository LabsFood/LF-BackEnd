import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { ContentCmsService } from './content-cms.service';
import { CmsPage } from '../../database/entities';

@Controller('content-cms')
@ApiTags('content-cms')
@ApiBearerAuth()

export class ContentCmsController {
  constructor(private readonly contentCmsService: ContentCmsService) {}

  @Get('concept')
  async getConcept(): Promise<CmsPage> {
    return this.contentCmsService.getConcept();
  }
}