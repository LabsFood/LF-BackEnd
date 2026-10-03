import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { ApiClerkAuthResponses } from '../../common/swagger/auth-responses';
import { CreateChefApplicationDto } from './dto/create-chef-application.dto';
import { UpdateChefApplicationDto } from './dto/update-chef-application.dto';
import { ChefApplicationsService } from './services/chef-applications.service';

/** The id the request carries, for joining logs to `audit_log.request_id`. */
const reqId = (req: { id?: unknown }): string | undefined =>
  typeof req.id === 'string' ? req.id : undefined;

/**
 * The one unauthenticated candidature route. Kept apart from
 * {@link MyChefApplicationController}, whose class-level `ClerkAuthGuard` must not
 * be traded for per-method guards where one missed decorator exposes a route.
 */
@ApiTags('chef-applications')
@Controller('chef-applications')
export class ChefApplicationsController {
  constructor(private readonly applications: ChefApplicationsService) {}

  @Post()
  @UseGuards(ThrottlerGuard)
  @ApiOperation({
    summary: 'Submit a batch cooker candidature and create the account (public)',
    description:
      'Creates the account with the candidature: a Clerk user with no password, the ' +
      '`users` row (`role: chef`) and a chef profile with `isVerified` and `isActive` ' +
      'false — browse-only until an admin approves. A single-use sign-in link valid ' +
      '7 days is emailed to the submitted address and **never returned here**: the ' +
      'inbox is the only way into the account. The `documents` list is computed by ' +
      'the API from the answers; the client does not choose what is required.',
  })
  @ApiCreatedResponse({
    description: 'Candidature accepted, with its computed document list.',
  })
  @ApiConflictResponse({
    description:
      '`EMAIL_ALREADY_USED` — the address already has an account. Nothing is attached ' +
      'to it; its owner signs in instead.',
  })
  @ApiUnprocessableEntityResponse({
    description: '`VALIDATION_FAILED` — see the message for the field.',
  })
  @ApiTooManyRequestsResponse({
    description: 'More than 5 submissions per hour from this IP.',
  })
  @ApiServiceUnavailableResponse({ description: 'Clerk is not configured.' })
  submit(@Body() payload: CreateChefApplicationDto, @Req() req: { id?: unknown }) {
    return this.applications.submit(payload, reqId(req));
  }
}

/**
 * The signed-in candidate's own candidature (FLOW-01 §4). Documents are handled
 * under `/me/chef-documents`, the same routes an approved chef uses.
 */
@ApiTags('chef-applications')
@ApiBearerAuth()
@Controller('me/chef-application')
@UseGuards(ClerkAuthGuard)
export class MyChefApplicationController {
  constructor(private readonly applications: ChefApplicationsService) {}

  @Get()
  @ApiOperation({
    summary: 'Your candidature',
    description:
      'Status, reference and dossier. On refusal, `refusal` carries the reason as the ' +
      'admin wrote it and `allowReapplyAfter`. Carries nothing internal: no admin ' +
      'notes, no position in the review queue.',
  })
  @ApiOkResponse({ description: 'Candidature with its documents and dossier status.' })
  @ApiNotFoundResponse({ description: 'This account has no candidature.' })
  @ApiClerkAuthResponses()
  mine(@CurrentClerkUser() user: ClerkUser) {
    return this.applications.mine(user.userId);
  }

  @Post('reapply')
  @ApiOperation({
    summary: 'Apply again after a refusal',
    description:
      'Reopens the refused candidature with fresh answers, from the reapply date on. ' +
      '`identity.email` must be the address of this account.',
  })
  @ApiCreatedResponse({ description: 'Candidature submitted again.' })
  @ApiConflictResponse({
    description:
      '`APPLICATION_NOT_REJECTED` — only a refused candidature can be resubmitted; ' +
      '`REAPPLY_TOO_EARLY` — before `allowReapplyAfter`.',
  })
  @ApiUnprocessableEntityResponse({
    description: '`VALIDATION_FAILED` — see the message for the field.',
  })
  @ApiClerkAuthResponses()
  reapply(
    @CurrentClerkUser() user: ClerkUser,
    @Body() payload: CreateChefApplicationDto,
    @Req() req: { id?: unknown },
  ) {
    return this.applications.reapply(user.userId, payload, reqId(req));
  }

  @Patch()
  @ApiOperation({
    summary: 'Correct your candidature while it awaits a decision',
    description:
      'Open while the candidature is `submitted` or `changes-requested`. Send only the ' +
      'sections you change — `identity` (without `email`), `address`, ' +
      '`interventionZones`, `workAuthorization`, `company` — each one whole: it replaces ' +
      'the stored section, and the result passes the same rules as a submission. ' +
      '`email` and `consent` cannot change and are refused. Prefill the form from ' +
      '`answers` in `GET /me/chef-application`; the response is that same view, since ' +
      'a changed answer can change which documents are required.',
  })
  @ApiOkResponse({
    description: 'The candidature with its answers and its recomputed dossier.',
  })
  @ApiConflictResponse({
    description:
      '`APPLICATION_DECIDED` — already approved or refused; `ANSWER_LOCKED` — a ' +
      'validated document proves an answer you changed (`documents` names it): ' +
      'deposit a new version of that document first.',
  })
  @ApiUnprocessableEntityResponse({
    description: '`VALIDATION_FAILED` — see the message for the field.',
  })
  @ApiNotFoundResponse({ description: 'This account has no candidature.' })
  @ApiClerkAuthResponses()
  update(
    @CurrentClerkUser() user: ClerkUser,
    @Body() payload: UpdateChefApplicationDto,
    @Req() req: { id?: unknown },
  ) {
    return this.applications.update(user.userId, payload, reqId(req));
  }
}
