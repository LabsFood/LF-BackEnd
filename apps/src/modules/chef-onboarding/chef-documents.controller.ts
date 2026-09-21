import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { ApiClerkAuthResponses } from '../../common/swagger/auth-responses';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfirmUploadDto, CreateUploadUrlDto } from './dto/chef-document.dto';
import { ChefDocumentsService } from './services/chef-documents.service';

const reqId = (req: { id?: unknown }): string | undefined =>
  typeof req.id === 'string' ? req.id : undefined;

/**
 * The living dossier of an approved batch cooker (FLOW-01 §7).
 *
 * Same deposit flow as the candidature, addressed by the chef profile instead of
 * the candidature — the rows are literally the same ones, so history carries over.
 */
@ApiTags('chef-documents')
@ApiBearerAuth()
@Controller('me/chef-documents')
@UseGuards(ClerkAuthGuard)
export class ChefDocumentsController {
  constructor(
    private readonly documents: ChefDocumentsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Resolves the caller's own chef profile plus the candidature it came from.
   *
   * The candidature supplies the answers that decide which documents are required;
   * without it the dossier could not be derived at all.
   */
  private async owner(user: ClerkUser) {
    const profile = await this.prisma.chefProfile.findFirst({
      where: { user: { clerkUserId: user.userId } },
      include: { application: true },
    });
    if (!profile)
      throw new NotFoundException('No batch cooker profile for this account.');
    return profile;
  }

  @Get()
  @ApiOperation({
    summary: 'Your dossier',
    description:
      'Every required document with its current state, plus the derived dossier status. ' +
      'A required document with no deposit reads `missing`.',
  })
  @ApiOkResponse({ description: 'Dossier status and documents.' })
  @ApiClerkAuthResponses()
  async dossier(@CurrentClerkUser() user: ClerkUser) {
    const profile = await this.owner(user);
    if (!profile.application) {
      throw new NotFoundException('No candidature is linked to this profile.');
    }
    return this.documents.dossier(
      { kind: 'chef', chefProfileId: profile.id },
      this.documents.answersOf(profile.application),
      { disabled: !profile.isActive && profile.autoSuspendedAt === null },
    );
  }

  @Post(':type/upload-url')
  @ApiOperation({ summary: 'Signed upload URL for a dossier document' })
  @ApiParam({ name: 'type', description: 'Document type, kebab-case.' })
  @ApiClerkAuthResponses()
  async uploadUrl(
    @CurrentClerkUser() user: ClerkUser,
    @Param('type') type: string,
    @Body() body: CreateUploadUrlDto,
  ) {
    const profile = await this.owner(user);
    return this.documents.createUploadUrl(
      { kind: 'chef', chefProfileId: profile.id },
      type,
      body,
    );
  }

  @Post(':type/confirm')
  @ApiOperation({
    summary: 'Confirm a dossier deposit',
    description:
      'Records a new version. Depositing a valid replacement for an expired blocking ' +
      'document is also what lifts an automatic suspension.',
  })
  @ApiClerkAuthResponses()
  async confirm(
    @CurrentClerkUser() user: ClerkUser,
    @Param('type') type: string,
    @Body() body: ConfirmUploadDto,
    @Req() req: { id?: unknown },
  ) {
    const profile = await this.owner(user);
    return this.documents.confirmUpload(
      { kind: 'chef', chefProfileId: profile.id },
      type,
      body,
      reqId(req),
    );
  }

  @Get(':type/versions')
  @ApiOperation({
    summary: 'Every deposit made for one document type',
    description: 'Newest first, including refusal reasons.',
  })
  @ApiClerkAuthResponses()
  async versions(@CurrentClerkUser() user: ClerkUser, @Param('type') type: string) {
    const profile = await this.owner(user);
    return this.documents.versions({ kind: 'chef', chefProfileId: profile.id }, type);
  }
}
