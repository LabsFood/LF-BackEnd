import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { ApiAdminAuthResponses } from '../../common/swagger/auth-responses';
import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { ContentCmsService } from './content-cms.service';
import { ConceptContentDto } from './dto/concept-content.dto';
import { UpdateConceptContentDto } from './dto/update-concept-content.dto';

@ApiTags('content-cms')
@Controller('content')
export class ContentCmsController {
  constructor(private readonly contentCms: ContentCmsService) {}

  @Get('concept')
  @ApiOperation({
    summary: 'Get public "Notre Concept" page content',
    description:
      'Public, unauthenticated read of the marketing concept page: hero, intro blocks, ' +
      'how-it-works steps, and reassurance items. Used by the consumer website.',
  })
  @ApiOkResponse({
    type: ConceptContentDto,
    description: 'Latest published concept page CMS payload.',
  })
  getConcept(): Promise<ConceptContentDto> {
    return this.contentCms.getConcept();
  }

  @Put('concept')
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Admin: replace concept page content',
    description:
      'Full replacement of the concept page CMS document. ' +
      'Requires `users.role = admin`. Previous content is overwritten.',
  })
  @ApiOkResponse({
    type: ConceptContentDto,
    description: 'Saved concept content after update.',
  })
  @ApiAdminAuthResponses()
  updateConcept(
    @Body() payload: UpdateConceptContentDto,
    @CurrentClerkUser() clerk: ClerkUser,
  ): Promise<ConceptContentDto> {
    return this.contentCms.updateConcept(payload, clerk.userId);
  }
}
