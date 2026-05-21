import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

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
  @ApiOkResponse({
    type: ConceptContentDto,
    description: 'Public "Notre Concept" page content.',
  })
  getConcept(): Promise<ConceptContentDto> {
    return this.contentCms.getConcept();
  }

  @Put('concept')
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOkResponse({
    type: ConceptContentDto,
    description: 'Saved concept content (admin only).',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid Clerk bearer token.' })
  @ApiForbiddenResponse({ description: 'Authenticated user is not an admin.' })
  updateConcept(
    @Body() payload: UpdateConceptContentDto,
    @CurrentClerkUser() clerk: ClerkUser,
  ): Promise<ConceptContentDto> {
    return this.contentCms.updateConcept(payload, clerk.userId);
  }
}
