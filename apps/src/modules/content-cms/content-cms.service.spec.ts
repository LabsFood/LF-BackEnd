import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CmsPage, UserRole } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { CmsPageStatus } from '../../supabase/types/cms-content';
import { UsersService } from '../users/users.service';
import { CONCEPT_SLUG, DEFAULT_CONCEPT_CONTENT } from './concept-defaults';
import { ContentCmsService } from './content-cms.service';
import { ConceptContentDto } from './dto/concept-content.dto';

describe('ContentCmsService', () => {
  let service: ContentCmsService;
  let cmsPages: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
  };
  let users: { findByClerkId: jest.Mock };

  const publishedPage = {
    id: 'page-1',
    slug: CONCEPT_SLUG,
    title: 'Stored title',
    hero: DEFAULT_CONCEPT_CONTENT.hero,
    introBlocks: DEFAULT_CONCEPT_CONTENT.introBlocks,
    howItWorks: DEFAULT_CONCEPT_CONTENT.howItWorks,
    reassuranceItems: DEFAULT_CONCEPT_CONTENT.reassuranceItems,
    status: CmsPageStatus.PUBLISHED,
    updatedByUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as CmsPage;

  beforeEach(async () => {
    cmsPages = {
      findUnique: jest.fn(),
      upsert: jest.fn(
        async (args: { update: Partial<CmsPage> }) =>
          ({
            ...publishedPage,
            ...args.update,
          }) as CmsPage,
      ),
    };
    users = {
      findByClerkId: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ContentCmsService,
        { provide: PrismaService, useValue: { cmsPage: cmsPages } },
        { provide: UsersService, useValue: users },
      ],
    }).compile();

    service = moduleRef.get(ContentCmsService);
  });

  it('returns deterministic defaults when the concept page is missing', async () => {
    cmsPages.findUnique.mockResolvedValue(null);
    const result = await service.getConcept();
    expect(result).toEqual(ConceptContentDto.fromContent(DEFAULT_CONCEPT_CONTENT));
  });

  it('maps a published concept page from persistence', async () => {
    cmsPages.findUnique.mockResolvedValue(publishedPage);
    const result = await service.getConcept();
    expect(result.title).toBe('Stored title');
  });

  it('persists a full replacement for admin users', async () => {
    cmsPages.findUnique.mockResolvedValue(publishedPage);
    users.findByClerkId.mockResolvedValue({
      id: 'admin-1',
      clerkUserId: 'clerk_admin',
      role: UserRole.admin,
    });

    const payload = ConceptContentDto.fromContent({
      ...DEFAULT_CONCEPT_CONTENT,
      title: 'Updated title',
    });

    const result = await service.updateConcept(payload, 'clerk_admin');
    expect(result.title).toBe('Updated title');
    expect(cmsPages.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          title: 'Updated title',
          status: CmsPageStatus.PUBLISHED,
          updatedByUserId: 'admin-1',
        }),
      }),
    );
  });

  it('rejects updates from non-admin users', async () => {
    users.findByClerkId.mockResolvedValue({
      id: 'client-1',
      role: UserRole.client,
    });

    await expect(
      service.updateConcept(
        ConceptContentDto.fromContent(DEFAULT_CONCEPT_CONTENT),
        'clerk_client',
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});
