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
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { ApiAdminAuthResponses } from '../../common/swagger/auth-responses';
import { TAGS } from '../../common/swagger/tags';
import { UsersService } from '../users/users.service';
import {
  ApproveApplicationDto,
  ListChefApplicationsQueryDto,
  RejectApplicationDto,
  RequestChangesDto,
} from './dto/admin-chef-application.dto';
import { ApiDocumentTypeParam, DecideDocumentDto } from './dto/chef-document.dto';
import { ChefApplicationsAdminService } from './services/chef-applications-admin.service';
import { ChefApplicationsService } from './services/chef-applications.service';
import {
  APPLICATION_DETAIL_EXAMPLE,
  APPROVED_EXAMPLE,
  DECISION_EXAMPLE,
  errorExample,
  QUEUE_EXAMPLE,
} from './swagger-examples';

const reqId = (req: { id?: unknown }): string | undefined =>
  typeof req.id === 'string' ? req.id : undefined;

const ApiApplicationIdParam = () =>
  ApiParam({
    name: 'id',
    description: 'The candidature id, from the review queue.',
    example: '0b8c2f1e-9d64-4c1b-8a4e-2f0d3c5a7b11',
  });

const NOT_FOUND = 'No candidature with this id, or its account was deleted.';

@ApiTags(TAGS.adminChefs)
@ApiBearerAuth()
@Controller('admin')
@UseGuards(ClerkAuthGuard, AdminGuard)
export class ChefApplicationsAdminController {
  constructor(
    private readonly admin: ChefApplicationsAdminService,
    private readonly applications: ChefApplicationsService,
    private readonly users: UsersService,
  ) {}

  /** The admin's Postgres uuid — audit rows record a person, not a Clerk subject. */
  private async adminId(user: ClerkUser): Promise<string> {
    const row = await this.users.findByClerkId(user.userId);
    return row!.id;
  }

  @Get('chef-applications')
  @ApiOperation({
    summary: 'List candidatures to review',
    description:
      'The review queue, one page at a time. Batch cookers taken offline by an expired ' +
      'document come first; `reactivatedPendingReview: true` marks those already back ' +
      'online on a replacement nobody has checked. `isActive` says whether clients can book ' +
      'the batch cooker right now. Then the longest wait first: ' +
      '`waitingSinceHours` helps keep the promise of an answer within 48 working hours.\n\n' +
      'Two different counts: `pendingDocuments` are uploaded documents waiting for your ' +
      'decision; `missingDocuments` are blocking documents the candidate has not uploaded ' +
      'yet, i.e. the dossiers to chase. A dossier with only missing documents has ' +
      '`pendingDocuments: 0`.\n\n' +
      'Example: `?status=submitted&hasPendingDocuments=true` lists what needs a look now.',
  })
  @ApiOkResponse({
    description: 'One page of candidatures.',
    example: QUEUE_EXAMPLE,
  })
  @ApiAdminAuthResponses()
  list(@Query() query: ListChefApplicationsQueryDto) {
    return this.admin.list(query);
  }

  @Get('chef-applications/:id')
  @ApiOperation({
    summary: 'Open one candidature',
    description:
      'Everything the candidate sent, their documents with the state of each, and ' +
      '`dossierStatus`. `isActive` says whether clients can book the batch cooker right now. ' +
      '`canApprove: true` means every blocking document is valid, so ' +
      'the candidature can be approved. To look at a file, ask for its link with ' +
      '`download-url`.',
  })
  @ApiApplicationIdParam()
  @ApiOkResponse({ description: 'The candidature.', example: APPLICATION_DETAIL_EXAMPLE })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiAdminAuthResponses()
  detail(@Param('id') id: string) {
    return this.admin.detail(id);
  }

  @Get('chef-applications/:id/documents/:type/download-url')
  @ApiDocumentTypeParam()
  @ApiOperation({
    summary: 'Get a link to view one document',
    description:
      'A private link to the latest version of the document, valid 5 minutes: open it ' +
      'right away. Every link handed out is recorded in the audit log with the admin ' +
      'who asked for it, because these are identity papers.',
  })
  @ApiApplicationIdParam()
  @ApiOkResponse({
    description: 'The link, and which version it shows.',
    example: {
      url: 'https://<project>.supabase.co/storage/v1/object/sign/labsfood-kyc/chefs/c2eebc99…/identity/up_9f2a…?token=eyJhbGciOi…',
      expiresAt: '2026-09-21T08:35:12.000Z',
      type: 'identity',
      version: 1,
    },
  })
  @ApiNotFoundResponse({
    description: `${NOT_FOUND} Or nothing was uploaded for this type.`,
  })
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
  @ApiDocumentTypeParam()
  @ApiOperation({
    summary: 'Accept or refuse one document',
    description:
      'Decides on the latest version of the document.\n\n' +
      '- Accept: `{ "decision": "valid" }`.\n' +
      '- Refuse: `{ "decision": "rejected", "reason": "…" }`. The reason (15 to 500 ' +
      'characters) is emailed to the candidate word for word, so say what to send ' +
      'instead. They upload a new version from their dossier.\n\n' +
      'The answer includes the new `dossierStatus` and `canApprove`, since one decision ' +
      'can change them. For a batch cooker already online, refusing a blocking document ' +
      'takes them offline.',
  })
  @ApiApplicationIdParam()
  @ApiOkResponse({
    description: 'The decided document and the dossier after it.',
    example: DECISION_EXAMPLE,
  })
  @ApiUnprocessableEntityResponse({
    description: '`REASON_REQUIRED`: refusing without a reason.',
    example: errorExample(
      'REASON_REQUIRED',
      'A refusal reason of 15 to 500 characters is required.',
    ),
  })
  @ApiForbiddenResponse({
    description:
      '`SYSTEM_DOCUMENT`: `sepa-mandate` is written from the Stripe signature.',
  })
  @ApiNotFoundResponse({
    description: `${NOT_FOUND} Or nothing was uploaded for this type.`,
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
    summary: 'Ask the candidate for more, without refusing',
    description:
      'For a dossier that can be neither approved nor refused as it stands. The ' +
      'candidature moves to `changes-requested` and the candidate is emailed your ' +
      '`message` with a link to their dossier.\n\n' +
      'Example: `{ "message": "Votre attestation RC Pro s\'arrête au 31/12/2026…", ' +
      '"documentTypes": ["rc-pro"] }`.\n\n' +
      'If they never used their first sign-in link, send a new one with ' +
      '`POST /admin/chef-users/{id}/resend-invitation`.',
  })
  @ApiApplicationIdParam()
  @ApiCreatedResponse({
    description: 'The new stage and the documents asked for.',
    example: { status: 'changes-requested', documentTypes: ['rc-pro'] },
  })
  @ApiConflictResponse({
    description: '`APPLICATION_DECIDED`: the candidature is already approved or refused.',
  })
  @ApiNotFoundResponse({ description: `${NOT_FOUND} Or a document type is unknown.` })
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
    summary: 'Approve the candidature',
    description:
      'The candidate becomes a verified batch cooker: their space stops being ' +
      'browse-only, and they get an "approved" email. The zones and SAP route from ' +
      'the candidature are copied onto their page.\n\n' +
      'They stay offline unless the body says `{ "isActive": true }`, so the page can ' +
      'be checked first.\n\n' +
      'Refused with `DOCUMENT_REQUIRED` until every blocking document is valid: no one ' +
      'is verified without a checked identity document. Approving twice returns the ' +
      'same result.',
  })
  @ApiApplicationIdParam()
  @ApiCreatedResponse({
    description: 'The approved candidature and the batch cooker.',
    example: APPROVED_EXAMPLE,
  })
  @ApiConflictResponse({
    description:
      '`DOCUMENT_REQUIRED`: some blocking documents are not valid yet (listed in ' +
      '`documents`). `APPLICATION_DECIDED`: the candidature was refused.',
    example: {
      code: 'DOCUMENT_REQUIRED',
      message: 'These documents must be validated first: registration.',
      documents: ['registration'],
    },
  })
  @ApiNotFoundResponse({ description: NOT_FOUND })
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
    summary: 'Refuse the candidature',
    description:
      'The candidate is emailed the `reason` word for word, and their space shows it ' +
      'with the date they may apply again (`allowReapplyAfter`, or any time if left ' +
      'out). The account stays, browse-only. Their documents are deleted 3 months ' +
      'later.\n\n' +
      'Example: `{ "reason": "Zone non couverte pour l\'instant.", "reasonCode": ' +
      '"out-of-area", "allowReapplyAfter": "2027-01-01" }`.',
  })
  @ApiApplicationIdParam()
  @ApiCreatedResponse({
    description: 'The refused candidature.',
    example: {
      id: '0b8c2f1e-9d64-4c1b-8a4e-2f0d3c5a7b11',
      status: 'rejected',
      allowReapplyAfter: '2027-01-01',
    },
  })
  @ApiConflictResponse({
    description: '`APPLICATION_DECIDED`: the candidature is already approved or refused.',
  })
  @ApiNotFoundResponse({ description: NOT_FOUND })
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
    summary: 'Email a batch cooker a new sign-in link',
    description:
      'For a batch cooker, approved or not, whose first link expired before they used ' +
      "it, or never arrived. A new link, valid 7 days, goes to the account's own " +
      'address; nobody else receives it, and it is not in the answer.\n\n' +
      '`delivered: false` means the email did not leave (email service down or not ' +
      'configured): try again later.',
  })
  @ApiParam({
    name: 'id',
    description:
      'The account id: `userId` on the candidature, in `GET /admin/chef-applications` ' +
      'and `GET /admin/chef-applications/{id}`.',
    example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  })
  @ApiCreatedResponse({
    description: 'Where the link was sent, and whether it left.',
    example: {
      channel: 'magic-link',
      sentTo: 'marie.dupont@exemple.fr',
      delivered: true,
      expiresAt: '2026-09-29T11:22:10.004Z',
    },
  })
  @ApiConflictResponse({
    description: '`NOT_A_CHEF`: this account is not a batch cooker.',
  })
  @ApiNotFoundResponse({ description: 'No account with this id.' })
  @ApiAdminAuthResponses()
  async resendInvitation(
    @Param('id') id: string,
    @CurrentClerkUser() user: ClerkUser,
    @Req() req: { id?: unknown },
  ) {
    return this.applications.resendSignInLink(id, await this.adminId(user), reqId(req));
  }
}
