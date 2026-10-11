import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { ApiAdminAuthResponses } from '../../common/swagger/auth-responses';
import { TAGS } from '../../common/swagger/tags';
import { ContactService } from './contact.service';
import {
  CONTACT_RATE_LIMIT,
  ListContactMessagesQueryDto,
  ReplyContactMessageDto,
  SubmitContactMessageDto,
  UpdateContactMessageDto,
} from './dto/contact.dto';

const MESSAGE_ID = '6f1ebc99-9c0b-4ef8-bb6d-6bb9bd380a77';

const MESSAGE = {
  id: MESSAGE_ID,
  source: 'labsfood',
  name: 'Sophie Marchand',
  email: 'sophie.marchand@exemple.fr',
  phone: '06 12 34 56 78',
  subject: 'Batch cooking',
  message: 'Bonjour, intervenez-vous à Nice pour une famille de quatre ?',
  status: 'new',
  createdAt: '2026-10-11T09:12:00.000Z',
  replies: [],
};

const REPLIED = {
  ...MESSAGE,
  status: 'replied',
  replies: [
    {
      id: '7a2ebc99-9c0b-4ef8-bb6d-6bb9bd380a88',
      body: 'Bonjour Sophie, oui, nous intervenons à Nice…',
      sentByName: 'Ivy Siyaptze',
      createdAt: '2026-10-11T10:02:00.000Z',
    },
  ],
};

const reqId = (req: { id?: unknown }): string | undefined =>
  typeof req.id === 'string' ? req.id : undefined;

const ApiMessageIdParam = () =>
  ApiParam({ name: 'id', description: 'The contact message id.', example: MESSAGE_ID });

/** The form itself: public, and therefore rate-limited. */
@ApiTags(TAGS.contact)
@Controller('contact-messages')
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  @Post()
  @UseGuards(ThrottlerGuard)
  // The module's one throttler, with this route's own budget.
  @Throttle({
    register: { limit: CONTACT_RATE_LIMIT.limit, ttl: CONTACT_RATE_LIMIT.windowMs },
  })
  @ApiOperation({
    summary: 'Send a contact form',
    description:
      'Public: no token needed. The message is stored in the admin inbox and the ' +
      'team is told by email. The answer never says more than `received`, to a ' +
      'person as to a robot.\n\n' +
      'At most 5 messages per hour from one IP address, and 5 per hour from one ' +
      'email address: both answer `429`.',
  })
  @ApiCreatedResponse({ description: 'The message is in.', example: { received: true } })
  @ApiTooManyRequestsResponse({
    description:
      'More than 5 messages in an hour, from this IP address or from this email ' +
      'address (`TOO_MANY_MESSAGES`).',
  })
  submit(@Body() body: SubmitContactMessageDto) {
    return this.contact.submit(body);
  }
}

@ApiTags(TAGS.adminContact)
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard, AdminGuard)
@Controller('admin/contact-messages')
export class AdminContactController {
  constructor(private readonly contact: ContactService) {}

  @Get()
  @ApiOperation({
    summary: 'List contact messages',
    description: 'Newest first, with the replies already sent. Filter with `status`.',
  })
  @ApiOkResponse({
    description: 'One page of messages.',
    example: {
      data: [MESSAGE],
      meta: {
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    },
  })
  @ApiAdminAuthResponses()
  list(@Query() query: ListContactMessagesQueryDto) {
    return this.contact.list(query);
  }

  @Get('counts')
  @ApiOperation({
    summary: 'Count messages by status',
    description: 'For the tabs of the inbox; `new` is the sidebar badge.',
  })
  @ApiOkResponse({
    description: 'The counts.',
    example: { new: 3, read: 1, replied: 12, archived: 40 },
  })
  @ApiAdminAuthResponses()
  counts() {
    return this.contact.counts();
  }

  @Get(':id')
  @ApiMessageIdParam()
  @ApiOperation({ summary: 'Read one contact message' })
  @ApiOkResponse({ description: 'The message.', example: MESSAGE })
  @ApiNotFoundResponse({ description: 'No such message.' })
  @ApiAdminAuthResponses()
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.contact.get(id);
  }

  @Patch(':id')
  @ApiMessageIdParam()
  @ApiOperation({
    summary: 'Mark a contact message as read, archived or new',
    description:
      'The inbox is shared: the status is the same for every admin. `replied` is ' +
      'refused here; it follows `POST …/reply`.',
  })
  @ApiOkResponse({ description: 'The message.', example: { ...MESSAGE, status: 'read' } })
  @ApiNotFoundResponse({ description: 'No such message.' })
  @ApiAdminAuthResponses()
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateContactMessageDto) {
    return this.contact.updateStatus(id, body);
  }

  @Post(':id/reply')
  @ApiMessageIdParam()
  @ApiOperation({
    summary: 'Answer a contact message by email',
    description:
      'Emails `body` to the sender, then records it and marks the message ' +
      '`replied`. If the email cannot be sent, nothing is recorded and the answer ' +
      'is `503 EMAIL_NOT_SENT`: a reply is never shown as sent when it was not.',
  })
  @ApiCreatedResponse({
    description: 'The message, with the new reply.',
    example: REPLIED,
  })
  @ApiNotFoundResponse({ description: 'No such message.' })
  @ApiServiceUnavailableResponse({
    description: '`EMAIL_NOT_SENT`: Brevo is not configured, or refused the email.',
  })
  @ApiAdminAuthResponses()
  reply(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReplyContactMessageDto,
    @Req() req: { id?: unknown },
  ) {
    return this.contact.reply(user.userId, id, body.body, reqId(req));
  }
}
