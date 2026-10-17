import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
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
import { TAGS } from '../../common/swagger/tags';
import { CreateChefApplicationDto } from './dto/create-chef-application.dto';
import { UpdateChefApplicationDto } from './dto/update-chef-application.dto';
import { ChefApplicationsService } from './services/chef-applications.service';
import {
  DOCUMENT_STATUS_HELP,
  DOSSIER_STATUS_HELP,
  errorExample,
  MY_APPLICATION_EXAMPLES,
  SUBMITTED_EXAMPLE,
} from './swagger-examples';

const VALIDATION_FAILED = {
  description:
    '`VALIDATION_FAILED`: the answers do not fit together, for example a SIRET sent by ' +
    'someone with no company, a bad SIRET key, or a postcode outside metropolitan ' +
    'France. `message` names the field.',
  example: errorExample(
    'VALIDATION_FAILED',
    'company.siret is required and must be 14 digits with a valid Luhn key.',
  ),
};

/** The id the request carries, for joining logs to `audit_log.request_id`. */
const reqId = (req: { id?: unknown }): string | undefined =>
  typeof req.id === 'string' ? req.id : undefined;

/**
 * The one unauthenticated candidature route. Kept apart from
 * {@link MyChefApplicationController}, whose class-level `ClerkAuthGuard` must not
 * be traded for per-method guards where one missed decorator exposes a route.
 */
@ApiTags(TAGS.candidature)
@Controller('chef-applications')
export class ChefApplicationsController {
  constructor(private readonly applications: ChefApplicationsService) {}

  @Post()
  @UseGuards(ThrottlerGuard)
  @ApiOperation({
    summary: 'Apply to become a batch cooker',
    description:
      'Sends the candidature form and creates the account at the same time. Public: no ' +
      'token needed.\n\n' +
      '**What happens next:** an email with a sign-in link (valid 7 days, usable once) ' +
      'goes to the address in the form. The link opens the site’s `/auth/login` page, ' +
      'which signs the person in and moves on to `/apres-connexion`. The link is never ' +
      'in this answer, so only the owner of the inbox can get in; `invitation.delivered` ' +
      'says whether the email left, and `false` means it did not: tell the person to ' +
      'contact Lab’s Food, who can send it again. Once signed in, the person sees a ' +
      'browse-only ' +
      'space until an admin approves them: they can follow the candidature ' +
      '(`GET /me/chef-application`) and upload documents (`/me/chef-documents`), ' +
      'nothing else.\n\n' +
      '`documents` in the answer lists what to upload. The API decides it from the ' +
      'answers: a candidate with no company is not asked for `registration`, for ' +
      'example. None is needed to submit.\n\n' +
      'An email that already has an account is refused: its owner should sign in ' +
      'instead. Limited to 5 candidatures per hour per IP address.',
  })
  @ApiCreatedResponse({
    description: 'The candidature, and the documents to provide.',
    example: SUBMITTED_EXAMPLE,
  })
  @ApiBadRequestResponse({
    description: 'A field is missing or malformed, or the body has an unknown field.',
  })
  @ApiConflictResponse({
    description: '`EMAIL_ALREADY_USED`: this email already has an account.',
    example: errorExample(
      'EMAIL_ALREADY_USED',
      'An account already exists for this email address. Sign in to continue.',
    ),
  })
  @ApiUnprocessableEntityResponse(VALIDATION_FAILED)
  @ApiTooManyRequestsResponse({
    description: 'More than 5 candidatures in an hour from this IP.',
  })
  @ApiServiceUnavailableResponse({
    description: 'The server has no Clerk key, so it cannot create accounts.',
  })
  submit(@Body() payload: CreateChefApplicationDto, @Req() req: { id?: unknown }) {
    return this.applications.submit(payload, reqId(req));
  }
}

/**
 * The signed-in candidate's own candidature (FLOW-01 §4). Documents are handled
 * under `/me/chef-documents`, the same routes an approved chef uses.
 */
@ApiTags(TAGS.candidature)
@ApiBearerAuth()
@Controller('me/chef-application')
@UseGuards(ClerkAuthGuard)
export class MyChefApplicationController {
  constructor(private readonly applications: ChefApplicationsService) {}

  @Get()
  @ApiOperation({
    summary: 'Follow my candidature',
    description:
      'What the candidate sees in their space.\n\n' +
      '`status`: `submitted` (being reviewed), `changes-requested` (an admin asked ' +
      'for documents again), `approved`, or `rejected`. When refused, `refusal` holds ' +
      'the reason as the admin wrote it and `allowReapplyAfter`, the day a new ' +
      'candidature is possible (`null`: any time).\n\n' +
      DOSSIER_STATUS_HELP +
      '\n\n' +
      DOCUMENT_STATUS_HELP,
  })
  @ApiOkResponse({
    description: 'The candidature and its documents.',
    examples: MY_APPLICATION_EXAMPLES,
  })
  @ApiNotFoundResponse({ description: 'This account has no candidature.' })
  @ApiClerkAuthResponses()
  mine(@CurrentClerkUser() user: ClerkUser) {
    return this.applications.mine(user.userId);
  }

  @Post('reapply')
  @ApiOperation({
    summary: 'Apply again after a refusal',
    description:
      'Sends the candidature form again, same body as `POST /chef-applications`, from ' +
      'the day in `refusal.allowReapplyAfter`. The same candidature goes back to ' +
      '`submitted` with the new answers. Documents already uploaded stay, with their ' +
      'status, unless they were deleted 3 months after the refusal.\n\n' +
      '`identity.email` must be the email of this account.',
  })
  @ApiCreatedResponse({
    description: 'The candidature, submitted again, with its documents.',
    example: MY_APPLICATION_EXAMPLES.reviewing.value,
  })
  @ApiBadRequestResponse({
    description: 'A field is missing or malformed, or the body has an unknown field.',
  })
  @ApiConflictResponse({
    description:
      '`REAPPLY_TOO_EARLY`: before `allowReapplyAfter`. `APPLICATION_NOT_REJECTED`: ' +
      'only a refused candidature can be sent again.',
    example: {
      code: 'REAPPLY_TOO_EARLY',
      message: 'A new candidature is possible from 2027-01-01.',
      allowReapplyAfter: '2027-01-01',
    },
  })
  @ApiUnprocessableEntityResponse({
    ...VALIDATION_FAILED,
    description: `${VALIDATION_FAILED.description} Also when \`identity.email\` is not this account's email.`,
  })
  @ApiNotFoundResponse({ description: 'This account has no candidature.' })
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
    examples: MY_APPLICATION_EXAMPLES,
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
