import { Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';

import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { ApiClerkAuthResponses } from '../../common/swagger/auth-responses';
import {
  SepaMandateSetupIntentDto,
  SepaMandateStatusDto,
} from './dto/stripe-connect.dto';
import { SepaMandatesService } from './sepa-mandates.service';

@ApiTags('Payments')
@ApiBearerAuth()
@Controller('me/chef-profile/sepa-mandate')
@UseGuards(ClerkAuthGuard)
export class SepaMandatesController {
  constructor(private readonly sepaMandates: SepaMandatesService) {}

  @Post('setup-intent')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({ register: true })
  @ApiOperation({
    summary: 'Start signing the commission direct-debit mandate',
    description:
      'Returns a Stripe SetupIntent client secret; the frontend collects the IBAN with ' +
      'Stripe Elements and confirms it there. **No money is ever debited in this phase** — ' +
      'the mandate is groundwork for the avance immédiate and CESU flows, where the ' +
      'commission cannot be split at charge time. Card payments do not need it.',
  })
  @ApiOkResponse({
    type: SepaMandateSetupIntentDto,
    description: 'SetupIntent client secret to confirm with Stripe Elements.',
  })
  @ApiConflictResponse({
    description: 'No chef profile yet — complete `PATCH /me/chef-profile` first.',
  })
  @ApiClerkAuthResponses()
  createSetupIntent(
    @CurrentClerkUser() user: ClerkUser,
  ): Promise<SepaMandateSetupIntentDto> {
    return this.sepaMandates.createSetupIntent(user.userId);
  }

  @Get()
  @ApiOperation({
    summary: 'Get my commission mandate status',
    description: 'Returns `null` when no mandate has been started.',
  })
  @ApiOkResponse({
    type: SepaMandateStatusDto,
    description: 'Mandate status, or `null` when none exists.',
  })
  @ApiConflictResponse({
    description: 'No chef profile yet — complete `PATCH /me/chef-profile` first.',
  })
  @ApiClerkAuthResponses()
  getStatus(@CurrentClerkUser() user: ClerkUser): Promise<SepaMandateStatusDto | null> {
    return this.sepaMandates.getStatus(user.userId);
  }
}
