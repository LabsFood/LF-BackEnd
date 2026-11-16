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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { ApiClerkAuthResponses } from '../../common/swagger/auth-responses';
import { TAGS } from '../../common/swagger/tags';
import {
  CreateAttachmentUploadDto,
  ListMessagesQueryDto,
  OpenConversationDto,
  SendMessageDto,
} from './dto/messaging.dto';
import { MessagingService } from './services/messaging.service';
import {
  ATTACHMENT_DOWNLOAD_EXAMPLE,
  ATTACHMENT_UPLOAD_EXAMPLE,
  CONVERSATION_DETAIL_EXAMPLE,
  CONVERSATION_EXAMPLE,
  CONVERSATION_ID,
  MASKING_HELP,
  MESSAGE_EXAMPLE,
  MESSAGE_PAGE_EXAMPLE,
  WEBSOCKET_HELP,
  errorExample,
} from './swagger-examples';

const NOT_FOUND = 'No such conversation, or the caller does not take part in it.';

const ApiConversationIdParam = () =>
  ApiParam({ name: 'id', description: 'The conversation id.', example: CONVERSATION_ID });

/**
 * The same routes for a client and a batch cooker: what a caller may read or
 * write comes from the conversations they take part in, never from their role.
 */
@ApiTags(TAGS.messaging)
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller('me/conversations')
export class MeConversationsController {
  constructor(private readonly messaging: MessagingService) {}

  @Get()
  @ApiOperation({
    summary: 'List my conversations',
    description:
      'Every conversation of the signed-in person, the most recently active first: ' +
      'one per client and batch cooker pair, plus the one with the Lab’s Food team if ' +
      `it was opened. ${MASKING_HELP}\n\n${WEBSOCKET_HELP}`,
  })
  @ApiOkResponse({ description: 'The conversations.', example: [CONVERSATION_EXAMPLE] })
  @ApiClerkAuthResponses()
  list(@CurrentClerkUser() user: ClerkUser) {
    return this.messaging.listMine(user.userId);
  }

  @Get('unread-count')
  @ApiOperation({
    summary: 'Count my unread messages',
    description: 'The total across all conversations, for the badge in the navigation.',
  })
  @ApiOkResponse({ description: 'The count.', example: { total: 3 } })
  @ApiClerkAuthResponses()
  unreadCount(@CurrentClerkUser() user: ClerkUser) {
    return this.messaging.unreadCount(user.userId);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Open the conversation of a booking or of a custom request',
    description:
      'Returns the conversation between the client and the batch cooker of one of ' +
      'the caller’s bookings, creating it on first use. There is one conversation ' +
      'per pair: every booking between the same two people leads to the same one.\n\n' +
      'With `quoteId` instead: the conversation between the client of a custom ' +
      'request and the batch cooker it is with, before any offer is accepted (to ' +
      'talk about a dish or an allergy). `404 QUOTE_NOT_FOUND` when the request is ' +
      'not the caller’s or has no batch cooker; `409 QUOTE_CLOSED` once withdrawn or ' +
      'closed.',
  })
  @ApiOkResponse({
    description: 'The conversation.',
    example: CONVERSATION_DETAIL_EXAMPLE,
  })
  @ApiNotFoundResponse({
    description: 'No such booking, or it is not the caller’s.',
    example: errorExample('BOOKING_NOT_FOUND', 'Booking not found.'),
  })
  @ApiConflictResponse({
    description: 'The booking is cancelled.',
    example: errorExample(
      'BOOKING_CANCELLED',
      'A cancelled booking does not open a conversation.',
    ),
  })
  @ApiClerkAuthResponses()
  open(@CurrentClerkUser() user: ClerkUser, @Body() body: OpenConversationDto) {
    return body.quoteId
      ? this.messaging.openForQuote(user.userId, body.quoteId)
      : this.messaging.openForBooking(user.userId, body.bookingId!);
  }

  @Post('support')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Open my conversation with the Lab’s Food team',
    description:
      'Returns the caller’s support conversation, creating it on first use. It is ' +
      'always open for writing, and nothing is masked in it.',
  })
  @ApiOkResponse({
    description: 'The conversation.',
    example: {
      ...CONVERSATION_DETAIL_EXAMPLE,
      type: 'support',
      counterpart: {
        role: 'support',
        name: 'Support Lab’s Food',
        avatarUrl: null,
        phone: null,
      },
      booking: null,
      contactReleaseAt: null,
      clientCard: null,
    },
  })
  @ApiClerkAuthResponses()
  openSupport(@CurrentClerkUser() user: ClerkUser) {
    return this.messaging.openSupport(user.userId);
  }

  @Get(':id')
  @ApiConversationIdParam()
  @ApiOperation({
    summary: 'Read one conversation',
    description:
      'The header of a thread: who the other person is, the prestation it is about, ' +
      'whether it is open for writing (`writable`) and whether contact details are ' +
      'released. A batch cooker also gets `clientCard`: the household, allergies and ' +
      'diets of the client, never the street address.',
  })
  @ApiOkResponse({
    description: 'The conversation.',
    example: CONVERSATION_DETAIL_EXAMPLE,
  })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiClerkAuthResponses()
  get(@CurrentClerkUser() user: ClerkUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.messaging.getMine(user.userId, id);
  }

  @Get(':id/messages')
  @ApiConversationIdParam()
  @ApiOperation({
    summary: 'Read the messages of a conversation',
    description:
      'The latest messages, oldest first. To load older ones, call again with ' +
      `\`before\` set to \`nextCursor\`; it is null at the top of the thread. ${MASKING_HELP}`,
  })
  @ApiOkResponse({ description: 'One page of messages.', example: MESSAGE_PAGE_EXAMPLE })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiClerkAuthResponses()
  messages(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListMessagesQueryDto,
  ) {
    return this.messaging.listMessages(user.userId, id, query);
  }

  @Post(':id/messages')
  @ApiConversationIdParam()
  @ApiOperation({
    summary: 'Send a message',
    description:
      'A text, files already uploaded, or both. The message is always delivered: a ' +
      'phone number or an email in it is masked for both people until the contact ' +
      'details are released, and the conversation is flagged for the team. The ' +
      'answer has `contactMasked: true` in that case, so the sender can be told.\n\n' +
      'Send a `clientMessageId` to make a retry safe.',
  })
  @ApiCreatedResponse({
    description: 'The message, as stored.',
    example: MESSAGE_EXAMPLE,
  })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiConflictResponse({
    description:
      '`CONVERSATION_READ_ONLY`: no prestation is ahead, and the last one ended more ' +
      'than 14 days ago. `UPLOAD_NOT_CONFIRMED`: an attached file was never uploaded.',
    example: errorExample(
      'CONVERSATION_READ_ONLY',
      'This conversation is closed: no prestation is ahead or recent. Write to support instead.',
    ),
  })
  @ApiUnprocessableEntityResponse({
    description: '`EMPTY_MESSAGE`, `UNSUPPORTED_MEDIA_TYPE` or `FILE_TOO_LARGE`.',
    example: errorExample('EMPTY_MESSAGE', 'A message needs a text or a file.'),
  })
  @ApiTooManyRequestsResponse({
    description: 'More than 20 messages in a minute.',
    example: errorExample('RATE_LIMITED', 'No more than 20 messages per minute.'),
  })
  @ApiClerkAuthResponses()
  send(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SendMessageDto,
  ) {
    return this.messaging.sendMessage(user.userId, id, body);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiConversationIdParam()
  @ApiOperation({
    summary: 'Mark a conversation as read',
    description:
      'Call it when the thread is opened or a message arrives while it is open.',
  })
  @ApiNoContentResponse({ description: 'Nothing left unread in this conversation.' })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiClerkAuthResponses()
  markRead(@CurrentClerkUser() user: ClerkUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.messaging.markRead(user.userId, id);
  }

  @Post(':id/attachments/upload-url')
  @ApiConversationIdParam()
  @ApiOperation({
    summary: 'Attach a file, step 1 of 3: get an upload link',
    description:
      'The file never goes through this API:\n\n' +
      '1. This call, with the file type and size. It answers with a private `url` ' +
      'valid 2 hours and an `uploadId`.\n' +
      '2. `PUT` the file to that `url`, with the `headers` given.\n' +
      '3. Send the message with `attachments: [{ uploadId, fileName }]`.\n\n' +
      'Nothing is recorded until step 3. PDF, JPEG, PNG or WebP, 10 MB at most, ' +
      '3 files per message.',
  })
  @ApiCreatedResponse({
    description: 'Where to send the file.',
    example: ATTACHMENT_UPLOAD_EXAMPLE,
  })
  @ApiUnprocessableEntityResponse({
    description: '`UNSUPPORTED_MEDIA_TYPE` or `FILE_TOO_LARGE`.',
    example: errorExample('FILE_TOO_LARGE', 'Maximum accepted size is 10 MB.'),
  })
  @ApiConflictResponse({ description: '`CONVERSATION_READ_ONLY`.' })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiClerkAuthResponses()
  uploadUrl(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateAttachmentUploadDto,
  ) {
    return this.messaging.createUploadUrl(user.userId, id, body);
  }

  @Get(':id/attachments/:attachmentId/download-url')
  @ApiConversationIdParam()
  @ApiParam({ name: 'attachmentId', description: 'The attachment id, from a message.' })
  @ApiOperation({
    summary: 'Get a link to read an attached file',
    description: 'A private link valid 5 minutes. Ask for a new one each time.',
  })
  @ApiOkResponse({ description: 'The link.', example: ATTACHMENT_DOWNLOAD_EXAMPLE })
  @ApiNotFoundResponse({ description: `${NOT_FOUND} Or no such attachment in it.` })
  @ApiClerkAuthResponses()
  downloadUrl(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
  ) {
    return this.messaging.attachmentDownloadUrl(user.userId, id, attachmentId);
  }
}
