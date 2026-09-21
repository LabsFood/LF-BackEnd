import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { ApiAdminAuthResponses } from '../../common/swagger/auth-responses';
import { UsersService } from '../users/users.service';
import {
  ApproveApplicationDto,
  ListChefApplicationsQueryDto,
  RejectApplicationDto,
  RequestChangesDto,
} from './dto/admin-chef-application.dto';
import { DecideDocumentDto } from './dto/chef-document.dto';
import { ChefApplicationsAdminService } from './services/chef-applications-admin.service';

const reqId = (req: { id?: unknown }): string | undefined =>
  typeof req.id === 'string' ? req.id : undefined;

@ApiTags('admin-chef-applications')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(ClerkAuthGuard, AdminGuard)
export class ChefApplicationsAdminController {
  constructor(
    private readonly admin: ChefApplicationsAdminService,
    private readonly users: UsersService,
  ) {}

  /** The admin's Postgres uuid — audit rows record a person, not a Clerk subject. */
  private async adminId(user: ClerkUser): Promise<string> {
    const row = await this.users.findByClerkId(user.userId);
    return row!.id;
  }

  @Get('chef-applications')
  @ApiOperation({
    summary: 'Review queue',
    description:
      'Oldest wait first. `waitingSinceHours` is what makes the « réponse sous 48 h ' +
      'ouvrées » promise sortable by urgency.',
  })
  @ApiOkResponse({
    description: 'One page of candidatures with their pending document counts.',
  })
  @ApiAdminAuthResponses()
  list(@Query() query: ListChefApplicationsQueryDto) {
    return this.admin.list(query);
  }

  @Get('chef-applications/:id')
  @ApiOperation({ summary: 'Full candidature, including what the candidate cannot see' })
  @ApiParam({ name: 'id', description: 'Candidature uuid.' })
  @ApiOkResponse({ description: 'Candidature, documents and derived dossier status.' })
  @ApiAdminAuthResponses()
  detail(@Param('id') id: string) {
    return this.admin.detail(id);
  }

  @Get('chef-applications/:id/documents/:type/download-url')
  @ApiOperation({
    summary: 'Signed read link for one document',
    description:
      'Valid five minutes, and written to the audit journal before it is handed over: ' +
      'an identity document is consulted, and every consultation is on the record.',
  })
  @ApiOkResponse({ description: 'Short-lived signed URL.' })
  @ApiAdminAuthResponses()
  async downloadUrl(
    @Param('id') id: string,
    @Param('type') type: string,
    @CurrentClerkUser() user: ClerkUser,
    @Req() req: { id?: unknown },
  ) {
    return this.admin.documentDownloadUrl(id, type, await this.adminId(user), reqId(req));
  }

  @Patch('chef-applications/:id/documents/:type')
  @ApiOperation({
    summary: 'Accept or refuse one document',
    description:
      'A refusal needs a reason of 15 to 500 characters, which the candidate reads ' +
      'verbatim, and sends them a fresh link to correct it. Returns the recomputed ' +
      'dossier status, because one decision can change the whole picture.',
  })
  @ApiConflictResponse({
    description: '`REASON_REQUIRED` when refusing without a reason.',
  })
  @ApiAdminAuthResponses()
  async decideDocument(
    @Param('id') id: string,
    @Param('type') type: string,
    @Body() body: DecideDocumentDto,
    @CurrentClerkUser() user: ClerkUser,
    @Req() req: { id?: unknown },
  ) {
    return this.admin.decideDocument(
      id,
      type,
      body,
      await this.adminId(user),
      reqId(req),
    );
  }

  @Post('chef-applications/:id/request-changes')
  @ApiOperation({
    summary: 'Ask for a correction without refusing',
    description:
      'Moves the candidature to `changes-requested` and extends the link by 30 days.',
  })
  @ApiAdminAuthResponses()
  async requestChanges(
    @Param('id') id: string,
    @Body() body: RequestChangesDto,
    @CurrentClerkUser() user: ClerkUser,
    @Req() req: { id?: unknown },
  ) {
    return this.admin.requestChanges(id, body, await this.adminId(user), reqId(req));
  }

  @Post('chef-applications/:id/approve')
  @ApiOperation({
    summary: 'Approve and create the batch cooker account',
    description:
      'One transaction: Clerk user, `users` row, chef profile, documents carried over, ' +
      'candidature token revoked, first-login link sent. **Refused with ' +
      '`DOCUMENT_REQUIRED` if any blocking document is not valid** — this is what ' +
      'guarantees no active chef exists without a validated identity document. ' +
      'Idempotent: approving twice returns the first result rather than creating a ' +
      'second account.',
  })
  @ApiConflictResponse({
    description: '`DOCUMENT_REQUIRED` — blocking documents still unvalidated.',
  })
  @ApiAdminAuthResponses()
  async approve(
    @Param('id') id: string,
    @Body() body: ApproveApplicationDto,
    @CurrentClerkUser() user: ClerkUser,
    @Req() req: { id?: unknown },
  ) {
    return this.admin.approve(id, body, await this.adminId(user), reqId(req));
  }

  @Post('chef-applications/:id/reject')
  @ApiOperation({
    summary: 'Refuse a candidature',
    description: 'Creates no account. The reason is sent to the candidate verbatim.',
  })
  @ApiAdminAuthResponses()
  async reject(
    @Param('id') id: string,
    @Body() body: RejectApplicationDto,
    @CurrentClerkUser() user: ClerkUser,
    @Req() req: { id?: unknown },
  ) {
    return this.admin.reject(id, body, await this.adminId(user), reqId(req));
  }

  @Post('chef-users/:id/resend-invitation')
  @ApiOperation({
    summary: 'Send the first-login link again',
    description: '`:id` is the Postgres user uuid of an approved batch cooker.',
  })
  @ApiAdminAuthResponses()
  async resendInvitation(
    @Param('id') id: string,
    @CurrentClerkUser() user: ClerkUser,
    @Req() req: { id?: unknown },
  ) {
    return this.admin.resendInvitation(id, await this.adminId(user), reqId(req));
  }
}
