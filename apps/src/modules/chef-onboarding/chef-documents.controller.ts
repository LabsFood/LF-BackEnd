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
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { ApiClerkAuthResponses } from '../../common/swagger/auth-responses';
import { TAGS } from '../../common/swagger/tags';
import { PrismaService } from '../../prisma/prisma.service';
import { isDisabledByAdmin } from './domain/chef-onboarding.rules';
import {
  ApiDocumentTypeParam,
  ConfirmUploadDto,
  CreateUploadUrlDto,
} from './dto/chef-document.dto';
import { ChefDocumentsService } from './services/chef-documents.service';
import { ChefDossierCron } from './services/chef-dossier.cron';
import {
  DEPOSIT_EXAMPLE,
  DOCUMENT_STATUS_HELP,
  DOSSIER_EXAMPLE,
  DOSSIER_STATUS_HELP,
  errorExample,
  UPLOAD_URL_EXAMPLE,
} from './swagger-examples';

const NOT_A_CHEF = 'This account is not a batch cooker.';

const reqId = (req: { id?: unknown }): string | undefined =>
  typeof req.id === 'string' ? req.id : undefined;

/**
 * A batch cooker's documents, from the candidature to the living dossier (FLOW-01
 * §3, §7). The account and its chef profile exist from submission, so a candidate
 * awaiting approval deposits here too, and the same rows carry over at approval.
 */
@ApiTags(TAGS.documents)
@ApiBearerAuth()
@Controller('me/chef-documents')
@UseGuards(ClerkAuthGuard)
export class ChefDocumentsController {
  constructor(
    private readonly documents: ChefDocumentsService,
    private readonly prisma: PrismaService,
    private readonly activation: ChefDossierCron,
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
    summary: 'List my documents and what is still needed',
    description:
      'Every document this batch cooker must or may provide, with the state of each ' +
      'and the latest upload. `required: true` marks the ones approval waits for. ' +
      'The list follows the candidature answers: nobody chooses it.\n\n' +
      'Works the same before approval (to build the dossier) and after (to keep it ' +
      'valid as documents expire).\n\n' +
      DOSSIER_STATUS_HELP +
      '\n\n' +
      DOCUMENT_STATUS_HELP,
  })
  @ApiOkResponse({ description: 'The dossier.', example: DOSSIER_EXAMPLE })
  @ApiNotFoundResponse({ description: NOT_A_CHEF })
  @ApiClerkAuthResponses()
  async dossier(@CurrentClerkUser() user: ClerkUser) {
    const profile = await this.owner(user);
    if (!profile.application) {
      throw new NotFoundException('No candidature is linked to this profile.');
    }
    return this.documents.dossier(
      profile.id,
      this.documents.answersOf(profile.application),
      { disabled: isDisabledByAdmin(profile) },
    );
  }

  @Post(':type/upload-url')
  @ApiOperation({
    summary: 'Upload a document, step 1 of 3: get an upload link',
    description:
      'Uploading takes three calls, and the file never goes through this API:\n\n' +
      '1. This call, with the file name, type and size. It answers with a private ' +
      '`url` valid 2 hours and an `uploadId`.\n' +
      '2. `PUT` the file itself to that `url`, with the `headers` given.\n' +
      '3. `POST /me/chef-documents/{type}/confirm` with the `uploadId`.\n\n' +
      'Nothing is recorded until step 3, so an abandoned upload leaves no trace. ' +
      'PDF, JPEG, PNG or WebP, 10 MB at most.',
  })
  @ApiDocumentTypeParam()
  @ApiCreatedResponse({
    description: 'Where to send the file.',
    example: UPLOAD_URL_EXAMPLE,
  })
  @ApiUnprocessableEntityResponse({
    description: '`UNSUPPORTED_MEDIA_TYPE` or `FILE_TOO_LARGE`.',
    example: errorExample('FILE_TOO_LARGE', 'Maximum accepted size is 10 MB.'),
  })
  @ApiNotFoundResponse({ description: `${NOT_A_CHEF} Or \`{type}\` is unknown.` })
  @ApiClerkAuthResponses()
  async uploadUrl(
    @CurrentClerkUser() user: ClerkUser,
    @Param('type') type: string,
    @Body() body: CreateUploadUrlDto,
  ) {
    const profile = await this.owner(user);
    return this.documents.createUploadUrl(profile.id, type, body);
  }

  @Post(':type/confirm')
  @ApiDocumentTypeParam()
  @ApiOperation({
    summary: 'Upload a document, step 3 of 3: confirm',
    description:
      'Call it once the `PUT` of step 2 succeeded. The API checks the file is really ' +
      'there, then records it as `submitted` for an admin to check.\n\n' +
      'Each upload is a new version: a refused document keeps its first version and ' +
      'reason, and the new one is checked again. `expiresOn` is required for ' +
      'documents that expire (see the field).\n\n' +
      'For a batch cooker taken offline because a blocking document expired, ' +
      'uploading its replacement puts them back online at once (`reactivated: true`), ' +
      'before any admin has checked it. A refusal takes them offline again.\n\n' +
      'Example body: `{ "uploadId": "up_9f2a…", "fileName": "cni-recto-verso.pdf", ' +
      '"expiresOn": "2028-03-14" }`.',
  })
  @ApiCreatedResponse({
    description: 'The recorded document, and whether the batch cooker is back online.',
    example: { ...DEPOSIT_EXAMPLE, reactivated: false },
  })
  @ApiConflictResponse({
    description: '`UPLOAD_NOT_CONFIRMED`: no file arrived for this `uploadId`.',
    example: errorExample(
      'UPLOAD_NOT_CONFIRMED',
      'No uploaded file was found for this upload id.',
    ),
  })
  @ApiUnprocessableEntityResponse({
    description:
      '`VALIDATION_FAILED`: `expiresOn` missing for a document that expires, or in the past.',
  })
  @ApiNotFoundResponse({ description: `${NOT_A_CHEF} Or \`{type}\` is unknown.` })
  @ApiClerkAuthResponses()
  async confirm(
    @CurrentClerkUser() user: ClerkUser,
    @Param('type') type: string,
    @Body() body: ConfirmUploadDto,
    @Req() req: { id?: unknown },
  ) {
    const profile = await this.owner(user);
    const document = await this.documents.confirmUpload(
      profile.id,
      type,
      body,
      reqId(req),
    );

    // FLOW-01 §7 "réversible immédiatement": depositing a replacement brings the
    // storefront back now, without waiting on the review queue. The document is
    // still unreviewed, and a later refusal takes the chef back offline.
    const reactivated = await this.activation.refreshActivation(profile.id);
    return { ...document, reactivated };
  }

  @Get(':type/versions')
  @ApiDocumentTypeParam()
  @ApiOperation({
    summary: 'See every upload of one document',
    description:
      'All versions ever uploaded for this document, newest first, each with its ' +
      'status and, if refused, the reason. Useful to show why a document was sent again.',
  })
  @ApiOkResponse({
    description: 'The versions, newest first.',
    example: [
      { ...DEPOSIT_EXAMPLE, version: 2 },
      {
        ...DEPOSIT_EXAMPLE,
        status: 'rejected',
        reason: 'Document illisible, merci de renvoyer la page entière.',
        reasonCode: 'unreadable',
        decidedAt: '2026-09-21T08:30:12.000Z',
      },
    ],
  })
  @ApiNotFoundResponse({ description: `${NOT_A_CHEF} Or \`{type}\` is unknown.` })
  @ApiClerkAuthResponses()
  async versions(@CurrentClerkUser() user: ClerkUser, @Param('type') type: string) {
    const profile = await this.owner(user);
    return this.documents.versions(profile.id, type);
  }
}
