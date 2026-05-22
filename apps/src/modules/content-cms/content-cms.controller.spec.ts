import { Test } from '@nestjs/testing';

import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { ContentCmsController } from './content-cms.controller';
import { ContentCmsService } from './content-cms.service';
import { ConceptContentDto } from './dto/concept-content.dto';
import { DEFAULT_CONCEPT_CONTENT } from './concept-defaults';

describe('ContentCmsController', () => {
  let controller: ContentCmsController;
  let contentCms: jest.Mocked<Pick<ContentCmsService, 'getConcept' | 'updateConcept'>>;

  const sampleDto = ConceptContentDto.fromContent(DEFAULT_CONCEPT_CONTENT);

  beforeEach(async () => {
    contentCms = {
      getConcept: jest.fn().mockResolvedValue(sampleDto),
      updateConcept: jest.fn().mockResolvedValue(sampleDto),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [ContentCmsController],
      providers: [{ provide: ContentCmsService, useValue: contentCms }],
    })
      .overrideGuard(ClerkAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(ContentCmsController);
  });

  it('delegates public concept reads to the service', async () => {
    await expect(controller.getConcept()).resolves.toEqual(sampleDto);
    expect(contentCms.getConcept).toHaveBeenCalled();
  });

  it('delegates admin concept updates to the service', async () => {
    const clerk: ClerkUser = { userId: 'clerk_admin', email: 'admin@example.com' };
    await expect(controller.updateConcept(sampleDto, clerk)).resolves.toEqual(sampleDto);
    expect(contentCms.updateConcept).toHaveBeenCalledWith(sampleDto, 'clerk_admin');
  });
});
