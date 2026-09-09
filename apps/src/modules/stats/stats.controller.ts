import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

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
  meDashboard(@CurrentClerkUser() user: ClerkUser) {
    return this.stats.getMyDashboard(user.userId);
  }

  @Get('me/stats')
  meStats(@CurrentClerkUser() user: ClerkUser) {
    return this.stats.getMyStats(user.userId);
  }

  @Get('admin/dashboard')
  @UseGuards(AdminGuard)
  adminDashboard() {
    return this.stats.getAdminDashboard();
  }
}
