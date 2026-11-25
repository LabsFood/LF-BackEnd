import {
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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { ApiClerkAuthResponses } from '../../common/swagger/auth-responses';
import { TAGS } from '../../common/swagger/tags';
import { NotificationsService } from './notifications.service';

const NOTIFICATION_ID = '7d1e2f40-7a3b-4d5c-9e6f-1a2b3c4d5e6f';

const NOTIFICATION_EXAMPLE = {
  id: NOTIFICATION_ID,
  type: 'allergy_conflict',
  subjectType: 'booking',
  subjectId: 'b4eebc99-9c0b-4ef8-bb6d-6bb9bd380a55',
  readAt: null,
  createdAt: '2026-10-31T09:00:00.000Z',
};

/**
 * The bell of the client and batch cooker spaces (Recettes §12). In the app only:
 * no e-mail is sent for these.
 */
@ApiTags(TAGS.me)
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller('me/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List my notifications',
    description:
      'Newest first, with `unreadCount` for the badge. A notification is a `type` and ' +
      'the thing it is about (`subjectType`, `subjectId`): the app words it from ' +
      '`type` and reads the subject for details. It never carries an allergy or ' +
      'personal data. Nothing here is also sent by e-mail.',
  })
  @ApiOkResponse({
    description: 'One page of notifications.',
    example: {
      data: [NOTIFICATION_EXAMPLE],
      meta: {
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      unreadCount: 1,
    },
  })
  @ApiClerkAuthResponses()
  list(@CurrentClerkUser() user: ClerkUser, @Query() query: PaginationQueryDto) {
    return this.notifications.listMine(user.userId, query);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', description: 'The notification id.', example: NOTIFICATION_ID })
  @ApiOperation({
    summary: 'Mark a notification read',
    description: 'Once: a notification already read keeps the time it was first read.',
  })
  @ApiOkResponse({
    description: 'The notification, read.',
    example: { ...NOTIFICATION_EXAMPLE, readAt: '2026-10-31T09:05:00.000Z' },
  })
  @ApiNotFoundResponse({
    description: '`NOTIFICATION_NOT_FOUND`: no such notification, or not the caller’s.',
  })
  @ApiClerkAuthResponses()
  markRead(@CurrentClerkUser() user: ClerkUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(user.userId, id);
  }
}
