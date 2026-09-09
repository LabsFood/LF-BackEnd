import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  ApiAdminAuthResponses,
  ApiClerkAuthResponses,
} from '../../common/swagger/auth-responses';
import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { StatsService } from './stats.service';

@ApiTags('stats')
@ApiBearerAuth()
@Controller()
@UseGuards(ClerkAuthGuard)
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get('me/dashboard')
  @ApiOperation({
    summary: 'Client dashboard summary',
    description:
      'Aggregated stats for the authenticated client: upcoming bookings, recent quotes, etc.',
  })
  @ApiOkResponse({ description: 'Client dashboard payload.' })
  @ApiClerkAuthResponses()
  meDashboard(@CurrentClerkUser() user: ClerkUser) {
    return this.stats.getMyDashboard(user.userId);
  }

  @Get('me/stats')
  @ApiOperation({
    summary: 'Client detailed statistics',
    description: 'Extended metrics for the authenticated client profile.',
  })
  @ApiOkResponse({ description: 'Client statistics payload.' })
  @ApiClerkAuthResponses()
  meStats(@CurrentClerkUser() user: ClerkUser) {
    return this.stats.getMyStats(user.userId);
  }

  @Get('admin/dashboard')
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Admin operations dashboard',
    description:
      'High-level KPIs for back-office: clients, bookings, quotes, and revenue indicators.',
  })
  @ApiOkResponse({ description: 'Admin dashboard payload.' })
  @ApiAdminAuthResponses()
  adminDashboard() {
    return this.stats.getAdminDashboard();
  }
}
