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
      'their most recently made booking (`null` when there is none).',
  })
  @ApiOkResponse({
    description: 'The figures.',
    example: {
      bookingsCount: 3,
      quotesCount: 1,
      latestBooking: {
        id: '7b1ebc99-9c0b-4ef8-bb6d-6bb9bd380a88',
        startsAt: '2026-10-02T09:00:00.000Z',
        endsAt: '2026-10-02T12:00:00.000Z',
        status: 'confirmed',
        priceCents: 9900,
        currency: 'EUR',
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
      'Everything the client booked, added up (`totals`: number of bookings and amounts ' +
      'in cents), and their quotes counted by status (`quotesByStatus`).',
  })
  @ApiOkResponse({
    description: 'The totals.',
    example: {
      totals: { _count: { _all: 3 }, _sum: { amountTtc: 29700, priceCents: 29700 } },
      quotesByStatus: [{ status: 'quoted', _count: { _all: 1 } }],
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
