import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CmsPage, CmsPageStatus, UserRole } from '../../supabase/entities';
import { UsersService } from '../users/users.service';
import { CONCEPT_SLUG, DEFAULT_CONCEPT_CONTENT } from './concept-defaults';
import { ConceptContentDto } from './dto/concept-content.dto';
import { UpdateConceptContentDto } from './dto/update-concept-content.dto';

@Injectable()
export class ContentCmsService {
  constructor(
    @InjectRepository(CmsPage)
    private readonly cmsPages: Repository<CmsPage>,
    private readonly users: UsersService,
  ) {}

  async getConcept(): Promise<ConceptContentDto> {
    const page = await this.cmsPages.findOne({ where: { slug: CONCEPT_SLUG } });
    if (!page || page.status !== CmsPageStatus.PUBLISHED) {
      return ConceptContentDto.fromContent(DEFAULT_CONCEPT_CONTENT);
    }
    return ConceptContentDto.fromEntity(page);
  }

  async updateConcept(
    payload: UpdateConceptContentDto,
    clerkUserId: string,
  ): Promise<ConceptContentDto> {
    const editor = await this.users.findByClerkId(clerkUserId);
    if (!editor || editor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin role required.');
    }

    let page = await this.cmsPages.findOne({ where: { slug: CONCEPT_SLUG } });
    if (!page) {
      page = this.cmsPages.create({ slug: CONCEPT_SLUG });
    }

    page.title = payload.title;
    page.hero = payload.hero;
    page.introBlocks = payload.introBlocks;
    page.howItWorks = payload.howItWorks;
    page.reassuranceItems = payload.reassuranceItems;
    page.status = CmsPageStatus.PUBLISHED;
    page.updatedByUserId = editor.id;

    const saved = await this.cmsPages.save(page);
    return ConceptContentDto.fromEntity(saved);
  }
}
