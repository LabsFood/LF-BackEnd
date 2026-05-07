import { Injectable, NotFoundException } from '@nestjs/common';import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CmsPage } from '../../database/entities';

@Injectable()
export class ContentCmsService {
  constructor(
    @InjectRepository(CmsPage)
    private readonly cmsPageRepository: Repository<CmsPage>,
  ) {}

  async getConcept(): Promise<CmsPage> {
    const page = await this.cmsPageRepository.findOne({ where: { slug: 'concept' } });
    if (!page) {
      throw new NotFoundException('CMS page "concept" not found');
    }
    return page;
  }
}
