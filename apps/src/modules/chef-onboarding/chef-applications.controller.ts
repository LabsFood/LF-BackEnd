import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { ChefApplication } from '../../generated/prisma/client';
import { ApplicationTokenGuard } from './application-token.guard';
import { CurrentApplication } from './current-application.decorator';
import { CreateChefApplicationDto } from './dto/create-chef-application.dto';
import { ConfirmUploadDto, CreateUploadUrlDto } from './dto/chef-document.dto';
import { ChefApplicationsService } from './services/chef-applications.service';
import { ChefDocumentsService } from './services/chef-documents.service';

/** The id the request carries, for joining logs to `audit_log.request_id`. */
const reqId = (req: { id?: unknown }): string | undefined =>
  typeof req.id === 'string' ? req.id : undefined;

@ApiTags('chef-applications')
@Controller('chef-applications')
export class ChefApplicationsController {
  constructor(
    private readonly applications: ChefApplicationsService,
    private readonly documents: ChefDocumentsService,
  ) {}

  @Post()
  @UseGuards(ThrottlerGuard)
  @ApiOperation({
    summary: 'Submit a batch cooker candidature (public)',
    description:
      'Creates a candidature and returns the reference plus a 30-day completion link. ' +
      '**No account is created**: there is no Clerk user and no `users` row until an ' +
      'admin approves. The `documents` list is computed by the API from the answers — ' +
      'the client does not choose what is required.',
  })
  @ApiCreatedResponse({
    description: 'Candidature accepted, with its computed document list.',
  })
  @ApiConflictResponse({
    description: '`EMAIL_ALREADY_USED` — an account or open candidature exists.',
  })
  @ApiUnprocessableEntityResponse({
    description: '`VALIDATION_FAILED` — see the message for the field.',
  })
  submit(@Body() payload: CreateChefApplicationDto, @Req() req: { id?: unknown }) {
    return this.applications.submit(payload, reqId(req));
  }

  @Get(':id')
  @UseGuards(ApplicationTokenGuard)
  @ApiOperation({
    summary: 'Read your own candidature (candidature token)',
    description:
      'Returns the dossier state for the candidate. Carries nothing internal: no admin ' +
      'notes, no position in the review queue.',
  })
  @ApiParam({ name: 'id', description: 'Candidature uuid.' })
  @ApiOkResponse({
    description: 'Candidature with its documents and derived dossier status.',
  })
  async get(@CurrentApplication() application: ChefApplication) {
    const dossier = await this.documents.dossier(
      { kind: 'application', applicationId: application.id },
      this.documents.answersOf(application),
    );
    return { ...this.applications.toCandidateView(application), ...dossier };
  }

  @Post(':id/documents/:type/upload-url')
  @UseGuards(ApplicationTokenGuard)
  @ApiOperation({
    summary: 'Get a signed upload URL for one document',
    description:
      'Step 1 of 3. The browser then PUTs the file straight to private storage and calls ' +
      '`confirm`. The file never transits the API. Rejects anything that is not PDF/JPEG/' +
      'PNG/WebP, or larger than 10 MB.',
  })
  @ApiUnprocessableEntityResponse({
    description: '`UNSUPPORTED_MEDIA_TYPE` or `FILE_TOO_LARGE`.',
  })
  uploadUrl(
    @CurrentApplication() application: ChefApplication,
    @Param('type') type: string,
    @Body() body: CreateUploadUrlDto,
  ) {
    return this.documents.createUploadUrl(
      { kind: 'application', applicationId: application.id },
      type,
      body,
    );
  }

  @Post(':id/documents/:type/confirm')
  @UseGuards(ApplicationTokenGuard)
  @ApiOperation({
    summary: 'Confirm a deposited document',
    description:
      'Step 3 of 3. Verifies the object really is in the bucket before recording the ' +
      'deposit, and records it as a **new version** — a document refused and corrected ' +
      'keeps both deposits and the refusal reason.',
  })
  @ApiConflictResponse({
    description: '`UPLOAD_NOT_CONFIRMED` — no uploaded file for that upload id.',
  })
  confirm(
    @CurrentApplication() application: ChefApplication,
    @Param('type') type: string,
    @Body() body: ConfirmUploadDto,
    @Req() req: { id?: unknown },
  ) {
    return this.documents.confirmUpload(
      { kind: 'application', applicationId: application.id },
      type,
      body,
      reqId(req),
    );
  }

  @Post(':id/resend-link')
  @UseGuards(ThrottlerGuard)
  @ApiOperation({
    summary: 'Send a fresh completion link',
    description:
      'Always to the address on the candidature, never to one supplied by the caller. ' +
      'Capped at three sends per rolling 24 hours.',
  })
  @ApiOkResponse({ description: 'A new 30-day link was sent.' })
  resendLink(@Param('id') id: string, @Req() req: { id?: unknown }) {
    return this.applications.resendLink(id, reqId(req));
  }
}
