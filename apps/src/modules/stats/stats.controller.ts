import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  ApiAdminAuthResponses,
  ApiClerkAuthResponses,
} from '../../common/swagger/auth-responses';
import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { TAGS } from '../../common/swagger/tags';
import { StatsService } from './stats.service';

@ApiBearerAuth()
@Controller()
@UseGuards(ClerkAuthGuard)
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get('me/dashboard')
  @ApiTags(TAGS.dashboards)
  @ApiOperation({
    summary: 'My dashboard',
    description:
      "The client's home screen figures: how many bookings and quotes they have, and " +
      '`nextBooking`, the session ahead of them — pending, confirmed or under way, ' +
      'not yet over — or `null` when there is none.',
  })
  @ApiOkResponse({
    description: 'The figures.',
    example: {
      bookingsCount: 3,
      quotesCount: 1,
      nextBooking: {
        id: '7b1ebc99-9c0b-4ef8-bb6d-6bb9bd380a88',
        reference: 'LF-2026-0001',
        startsAt: '2026-10-02T09:00:00.000Z',
        endsAt: '2026-10-02T12:00:00.000Z',
        status: 'confirmed',
        chefName: 'Awa Diallo',
      },
    },
  })
  @ApiClerkAuthResponses()
  meDashboard(@CurrentClerkUser() user: ClerkUser) {
    return this.stats.getMyDashboard(user.userId);
  }

  @Get('me/stats')
  @ApiTags(TAGS.dashboards)
  @ApiOperation({
    summary: 'My totals',
    description:
      'Everything the client booked, cancelled bookings left out (`totals`: number of ' +
      'bookings, `amountTtc` and `amountAfterTax` in cents), and their quotes counted ' +
      'by status (`quotesByStatus`, only the statuses they have).',
  })
  @ApiOkResponse({
    description: 'The totals.',
    example: {
      totals: { bookings: 3, amountTtc: 29700, amountAfterTax: 14850 },
      quotesByStatus: { quoted: 1, submitted: 2 },
    },
  })
  @ApiClerkAuthResponses()
  meStats(@CurrentClerkUser() user: ClerkUser) {
    return this.stats.getMyStats(user.userId);
  }

  @Get('admin/dashboard')
  @ApiTags(TAGS.adminDashboard)
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Back-office figures',
    description:
      'Across all bookings: `revenue` (sums in cents, before and after the tax credit), ' +
      '`sessionsByStatus` (bookings per status), `formuleSplit` (bookings per formule) ' +
      'and `topMeals` (the 5 meals with the most portions booked).',
  })
  @ApiOkResponse({
    description: 'The figures.',
    example: {
      revenue: { amountTtc: 594000, amountAfterTax: 297000, priceCents: 594000 },
      sessionsByStatus: [
        { status: 'confirmed', _count: { _all: 42 } },
        { status: 'completed', _count: { _all: 18 } },
      ],
      formuleSplit: [{ formuleId: 'confort', _count: { _all: 30 } }],
      topMeals: [
        { mealId: 'd3eebc99-9c0b-4ef8-bb6d-6bb9bd380a44', _sum: { portions: 120 } },
      ],
    },
  })
  @ApiAdminAuthResponses()
  adminDashboard() {
    return this.stats.getAdminDashboard();
  }
}
