import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
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
import {
  AdminListConversationsQueryDto,
  CreateAttachmentUploadDto,
  ListMessagesQueryDto,
  OpenSupportConversationDto,
  SendMessageDto,
} from './dto/messaging.dto';
import { MessagingAdminService } from './services/messaging-admin.service';
import {
  ADMIN_CONVERSATION_EXAMPLE,
  ADMIN_MESSAGE_EXAMPLE,
  ATTACHMENT_DOWNLOAD_EXAMPLE,
  ATTACHMENT_UPLOAD_EXAMPLE,
  CONVERSATION_ID,
  WEBSOCKET_HELP,
  errorExample,
} from './swagger-examples';

const NOT_FOUND = 'No such conversation.';

const reqId = (req: { id?: unknown }): string | undefined =>
  typeof req.id === 'string' ? req.id : undefined;

const ApiConversationIdParam = () =>
  ApiParam({ name: 'id', description: 'The conversation id.', example: CONVERSATION_ID });

@ApiTags(TAGS.adminMessaging)
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard, AdminGuard)
@Controller('admin/conversations')
export class AdminConversationsController {
  constructor(private readonly admin: MessagingAdminService) {}

  @Get()
  @ApiOperation({
    summary: 'List conversations',
    description:
      'Conversations with at least one message, the most recently active first. ' +
      '`type=support` is the inbox of the team; `type=chef_client` the threads ' +
      'between clients and batch cookers, for moderation. `filter=unread` keeps the ' +
      'support threads waiting for an answer, `filter=flagged` the threads where a ' +
      `phone number or an email was detected.\n\n${WEBSOCKET_HELP} An admin socket ` +
      'receives the events of every conversation, with the text as written.',
  })
  @ApiOkResponse({
    description: 'One page of conversations.',
    example: {
      data: [ADMIN_CONVERSATION_EXAMPLE],
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
  list(@Query() query: AdminListConversationsQueryDto) {
    return this.admin.list(query);
  }

  @Get('counts')
  @ApiOperation({
    summary: 'Count what needs attention',
    description:
      '`unread`: messages in support threads the team has not opened. `flagged`: ' +
      'threads with a detected contact detail, not dismissed yet. For the badge.',
  })
  @ApiOkResponse({ description: 'The counts.', example: { unread: 4, flagged: 1 } })
  @ApiAdminAuthResponses()
  counts() {
    return this.admin.counts();
  }

  @Post('support')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Open the support conversation of a user',
    description:
      'For the team to write first, to a client or a batch cooker. Returns the ' +
      'existing support conversation of that person, or creates it.',
  })
  @ApiOkResponse({
    description: 'The conversation.',
    example: {
      ...ADMIN_CONVERSATION_EXAMPLE,
      type: 'support',
      client: null,
      chef: null,
      supportUser: { ...ADMIN_CONVERSATION_EXAMPLE.client, role: 'client' },
      booking: null,
      contactFlaggedAt: null,
    },
  })
  @ApiNotFoundResponse({
    description: 'No client or batch cooker with this id.',
    example: errorExample('USER_NOT_FOUND', 'No client or batch cooker with this id.'),
  })
  @ApiAdminAuthResponses()
  openSupport(@Body() body: OpenSupportConversationDto) {
    return this.admin.openSupport(body.userId);
  }

  @Get(':id')
  @ApiConversationIdParam()
  @ApiOperation({ summary: 'Read one conversation' })
  @ApiOkResponse({
    description: 'The conversation.',
    example: ADMIN_CONVERSATION_EXAMPLE,
  })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiAdminAuthResponses()
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.get(id);
  }

  @Get(':id/messages')
  @ApiConversationIdParam()
  @ApiOperation({
    summary: 'Read the messages of a conversation',
    description:
      'The latest messages, oldest first, with the text as written: nothing is ' +
      'masked for the team, and `contactDetected` marks the messages that tripped ' +
      'the detection. Page upwards with `before`. Opening a conversation between a ' +
      'client and a batch cooker is recorded in the audit log.',
  })
  @ApiOkResponse({
    description: 'One page of messages.',
    example: { data: [ADMIN_MESSAGE_EXAMPLE], nextCursor: null },
  })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiAdminAuthResponses()
  messages(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListMessagesQueryDto,
    @Req() req: { id?: unknown },
  ) {
    return this.admin.listMessages(user.userId, id, query, reqId(req));
  }

  @Post(':id/messages')
  @ApiConversationIdParam()
  @ApiOperation({
    summary: 'Write in a conversation, as the team',
    description:
      'In a support thread, this is the answer. In a thread between a client and a ' +
      'batch cooker, both read it as a message from Lab’s Food, and the intervention ' +
      'is recorded in the audit log. The team can write in a closed thread.',
  })
  @ApiCreatedResponse({ description: 'The message.', example: ADMIN_MESSAGE_EXAMPLE })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiUnprocessableEntityResponse({
    description: '`EMPTY_MESSAGE`, `UNSUPPORTED_MEDIA_TYPE` or `FILE_TOO_LARGE`.',
  })
  @ApiAdminAuthResponses()
  send(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SendMessageDto,
    @Req() req: { id?: unknown },
  ) {
    return this.admin.sendMessage(user.userId, id, body, reqId(req));
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiConversationIdParam()
  @ApiOperation({
    summary: 'Mark a support conversation as read',
    description: 'For the whole team: the inbox is shared.',
  })
  @ApiNoContentResponse({ description: 'Nothing left unread in this conversation.' })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiAdminAuthResponses()
  markRead(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.markRead(id);
  }

  @Post(':id/dismiss-flag')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiConversationIdParam()
  @ApiOperation({
    summary: 'Dismiss the contact flag of a conversation',
    description:
      'Takes the conversation out of the `flagged` queue once someone has looked. ' +
      'A new detection flags it again. Recorded in the audit log.',
  })
  @ApiNoContentResponse({ description: 'The conversation is no longer flagged.' })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiAdminAuthResponses()
  dismissFlag(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { id?: unknown },
  ) {
    return this.admin.dismissFlag(user.userId, id, reqId(req));
  }

  @Post(':id/attachments/upload-url')
  @ApiConversationIdParam()
  @ApiOperation({
    summary: 'Attach a file, step 1 of 3: get an upload link',
    description:
      'Same three steps as for a participant: this call, a `PUT` of the file to the ' +
      '`url`, then the message with `attachments: [{ uploadId, fileName }]`.',
  })
  @ApiCreatedResponse({
    description: 'Where to send the file.',
    example: ATTACHMENT_UPLOAD_EXAMPLE,
  })
  @ApiUnprocessableEntityResponse({
    description: '`UNSUPPORTED_MEDIA_TYPE` or `FILE_TOO_LARGE`.',
  })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiAdminAuthResponses()
  uploadUrl(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateAttachmentUploadDto,
  ) {
    return this.admin.createUploadUrl(user.userId, id, body);
  }

  @Get(':id/attachments/:attachmentId/download-url')
  @ApiConversationIdParam()
  @ApiParam({ name: 'attachmentId', description: 'The attachment id, from a message.' })
  @ApiOperation({
    summary: 'Get a link to read an attached file',
    description: 'A private link valid 5 minutes.',
  })
  @ApiOkResponse({ description: 'The link.', example: ATTACHMENT_DOWNLOAD_EXAMPLE })
  @ApiNotFoundResponse({ description: `${NOT_FOUND} Or no such attachment in it.` })
  @ApiAdminAuthResponses()
  downloadUrl(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
  ) {
    return this.admin.attachmentDownloadUrl(id, attachmentId);
  }
}
