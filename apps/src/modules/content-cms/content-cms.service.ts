import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '../../generated/prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { CmsPageStatus } from '../../supabase/types/cms-content';
import { UsersService } from '../users/users.service';
import { CONCEPT_SLUG, DEFAULT_CONCEPT_CONTENT } from './concept-defaults';
import { ConceptContentDto } from './dto/concept-content.dto';
import { UpdateConceptContentDto } from './dto/update-concept-content.dto';

@Injectable()
export class ContentCmsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  async getConcept(): Promise<ConceptContentDto> {
    const page = await this.prisma.cmsPage.findUnique({ where: { slug: CONCEPT_SLUG } });
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
    if (!editor || editor.role !== UserRole.admin) {
      throw new ForbiddenException('Admin role required.');
    }

    const saved = await this.prisma.cmsPage.upsert({
      where: { slug: CONCEPT_SLUG },
      create: {
        slug: CONCEPT_SLUG,
        title: payload.title,
        hero: payload.hero as unknown as Prisma.InputJsonValue,
        introBlocks: payload.introBlocks as unknown as Prisma.InputJsonValue,
        howItWorks: payload.howItWorks as unknown as Prisma.InputJsonValue,
        reassuranceItems: payload.reassuranceItems as unknown as Prisma.InputJsonValue,
        status: CmsPageStatus.PUBLISHED,
        updatedByUserId: editor.id,
      },
      update: {
        title: payload.title,
        hero: payload.hero as unknown as Prisma.InputJsonValue,
        introBlocks: payload.introBlocks as unknown as Prisma.InputJsonValue,
        howItWorks: payload.howItWorks as unknown as Prisma.InputJsonValue,
        reassuranceItems: payload.reassuranceItems as unknown as Prisma.InputJsonValue,
        status: CmsPageStatus.PUBLISHED,
        updatedByUserId: editor.id,
      },
    });

    return ConceptContentDto.fromEntity(saved);
  }
}
