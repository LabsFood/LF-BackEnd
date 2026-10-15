import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';

import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { ApiClerkAuthResponses } from '../../common/swagger/auth-responses';
import { TAGS } from '../../common/swagger/tags';
import { CalendarFeedService } from './calendar-feed.service';

const NO_CHEF = 'No batch cooker page for this account (`NOT_A_CHEF`).';
const NOT_VERIFIED = 'The candidature is not approved yet (`CHEF_NOT_VERIFIED`).';

const STATUS_EXAMPLE = {
  enabled: true,
  createdAt: '2026-10-15T08:00:00.000Z',
  rotatedAt: null,
  lastFetchedAt: '2026-10-15T10:12:00.000Z',
  synced: true,
};

@ApiTags(TAGS.chefBookings)
@ApiBearerAuth()
@Controller('chef/calendar-feed')
@UseGuards(ClerkAuthGuard)
export class ChefCalendarFeedController {
  constructor(private readonly feeds: CalendarFeedService) {}

  @Get()
  @ApiOperation({
    summary: 'My calendar feed',
    description:
      'Whether my prestations are published as a feed, and when a calendar app last ' +
      'fetched it. `synced`: fetched in the last 7 days. The link itself is never ' +
      'shown again: make a new one to see it.',
  })
  @ApiOkResponse({ description: 'The feed.', example: STATUS_EXAMPLE })
  @ApiNotFoundResponse({ description: NO_CHEF })
  @ApiForbiddenResponse({ description: NOT_VERIFIED })
  @ApiClerkAuthResponses()
  status(@CurrentClerkUser() user: ClerkUser) {
    return this.feeds.status(user.userId);
  }

  @Post()
  @ApiOperation({
    summary: 'Make my calendar feed link, or a new one',
    description:
      'A private link to subscribe to from Google Calendar ("From URL", with `url`), ' +
      'Apple Calendar or Outlook (`webcalUrl`). It carries my prestations from a ' +
      'month back to a year ahead: client first name and initial, address, persons ' +
      'and status. **Shown once.** Making a new one stops the old one at once: do ' +
      'it if the link leaked.',
  })
  @ApiCreatedResponse({
    description: 'The link, this once.',
    example: {
      ...STATUS_EXAMPLE,
      url: 'https://api.labsfood.fr/calendar/feed/Xq9…v4.ics',
      webcalUrl: 'webcal://api.labsfood.fr/calendar/feed/Xq9…v4.ics',
      lastFetchedAt: null,
      synced: false,
    },
  })
  @ApiNotFoundResponse({ description: NO_CHEF })
  @ApiForbiddenResponse({ description: NOT_VERIFIED })
  @ApiClerkAuthResponses()
  issue(@CurrentClerkUser() user: ClerkUser, @Req() req: FastifyRequest) {
    // This API as the caller reached it; Railway's proxy headers are trusted.
    return this.feeds.issue(user.userId, `${req.protocol}://${req.host}`);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Turn my calendar feed off',
    description: 'The link stops working at once. Calendar apps keep what they fetched.',
  })
  @ApiNoContentResponse({ description: 'Off.' })
  @ApiNotFoundResponse({ description: NO_CHEF })
  @ApiForbiddenResponse({ description: NOT_VERIFIED })
  @ApiClerkAuthResponses()
  disable(@CurrentClerkUser() user: ClerkUser) {
    return this.feeds.disable(user.userId);
  }
}

/** What a calendar app fetches: no token header, the secret is in the path. */
@Controller('calendar/feed')
// Public: rate-limited per route and IP, generously, as calendar apps poll.
@UseGuards(ThrottlerGuard)
@Throttle({
  register: { limit: 60, ttl: 60_000 },
  payments: { limit: 60, ttl: 60_000 },
})
export class PublicCalendarFeedController {
  constructor(private readonly feeds: CalendarFeedService) {}

  @Get(':file')
  @ApiTags(TAGS.catalog)
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'A batch cooker’s calendar feed',
    description:
      'The `.ics` a calendar app subscribes to, from `POST /chef/calendar-feed`. ' +
      'Unknown and turned-off links are the same 404 `FEED_NOT_FOUND`.',
  })
  @ApiParam({ name: 'file', description: 'The secret token, then `.ics`.' })
  @ApiProduces('text/calendar')
  @ApiOkResponse({ description: 'iCalendar (RFC 5545).' })
  @ApiNotFoundResponse({ description: '`FEED_NOT_FOUND`.' })
  feed(@Param('file') file: string, @Ip() ip: string) {
    return this.feeds.feed(file.replace(/\.ics$/, ''), ip);
  }
}
