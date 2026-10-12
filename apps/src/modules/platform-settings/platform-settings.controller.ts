import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import {
  ApiAdminAuthResponses,
  ApiClerkAuthResponses,
} from '../../common/swagger/auth-responses';
import { TAGS } from '../../common/swagger/tags';
import { UsersService } from '../users/users.service';
import { PlatformSettingsService } from './platform-settings.service';

/** Half the client price at most: above that the setting is a typing mistake. */
const MAX_COMMISSION_BPS = 5000;

class UpdateCommissionDto {
  @ApiProperty({
    minimum: 0,
    maximum: MAX_COMMISSION_BPS,
    description: 'The commission in basis points: `1500` is 15 %.',
    example: 1500,
  })
  @IsInt()
  @Min(0)
  @Max(MAX_COMMISSION_BPS)
  commissionBps!: number;
}

const reqId = (req: { id?: unknown }): string | undefined =>
  typeof req.id === 'string' ? req.id : undefined;

@Controller()
export class PlatformSettingsController {
  constructor(
    private readonly settings: PlatformSettingsService,
    private readonly users: UsersService,
  ) {}

  @Get('pricing-rules')
  @ApiTags(TAGS.quotes)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard)
  @ApiOperation({
    summary: 'Read how a net becomes a client price',
    description:
      'For the screens that preview a price while it is typed. `commissionBps` is ' +
      'the platform commission and `taxCreditBps` the "services à la personne" tax ' +
      'credit, both in basis points (`1500` = 15 %).\n\n' +
      'The client price is `net × 10000 / (10000 − commissionBps)`, and what the ' +
      'client bears after the credit is `clientPrice × (10000 − taxCreditBps) / 10000`. ' +
      'A preview only: the amounts that count are the ones the API returns on the ' +
      'offer.',
  })
  @ApiOkResponse({
    description: 'The rates.',
    example: { commissionBps: 1500, taxCreditBps: 5000 },
  })
  @ApiClerkAuthResponses()
  pricingRules() {
    return this.settings.pricingRules();
  }

  @Get('admin/settings/commission')
  @ApiTags(TAGS.adminQuotes)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({ summary: 'Read the platform commission' })
  @ApiOkResponse({
    description: 'The rate, and when it last changed (`null`: never).',
    example: { commissionBps: 1500, updatedAt: '2026-10-12T09:00:00.000Z' },
  })
  @ApiAdminAuthResponses()
  commission() {
    return this.settings.commission();
  }

  @Patch('admin/settings/commission')
  @ApiTags(TAGS.adminQuotes)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Change the platform commission',
    description:
      'Applies to what is priced from now on. An offer already sent keeps the rate ' +
      'it was priced with, stored on it. Recorded in the audit log.',
  })
  @ApiOkResponse({
    description: 'The new rate.',
    example: { commissionBps: 1200, updatedAt: '2026-10-12T09:00:00.000Z' },
  })
  @ApiAdminAuthResponses()
  async setCommission(
    @CurrentClerkUser() user: ClerkUser,
    @Body() body: UpdateCommissionDto,
    @Req() req: { id?: unknown },
  ) {
    const admin =
      (await this.users.findByClerkId(user.userId)) ??
      (await this.users.ensurePersistedFromClerk(user.userId));
    return this.settings.setCommission(body.commissionBps, admin.id, reqId(req));
  }
}
