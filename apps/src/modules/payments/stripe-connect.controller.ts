import { Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { ApiClerkAuthResponses } from '../../common/swagger/auth-responses';
import { StripeConnectLinkDto, StripeConnectStatusDto } from './dto/stripe-connect.dto';
import { StripeConnectService } from './stripe-connect.service';

@ApiTags('Payments')
@ApiBearerAuth()
@Controller('me/chef-profile/stripe-connect')
@UseGuards(ClerkAuthGuard)
export class StripeConnectController {
  constructor(private readonly stripeConnect: StripeConnectService) {}

  @Post('link')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Start or resume Stripe Connect onboarding',
    description:
      'Creates the chef Express account on first call, then returns a single-use Stripe ' +
      'hosted onboarding URL. Links expire quickly — call this again rather than caching ' +
      'the URL. A chef cannot be paid until onboarding leaves `chargesEnabled` and ' +
      '`payoutsEnabled` true.',
  })
  @ApiOkResponse({ type: StripeConnectLinkDto, description: 'Hosted onboarding URL.' })
  @ApiConflictResponse({
    description: 'No chef profile yet — complete `PATCH /me/chef-profile` first.',
  })
  @ApiClerkAuthResponses()
  createLink(@CurrentClerkUser() user: ClerkUser): Promise<StripeConnectLinkDto> {
    return this.stripeConnect.createOnboardingLink(user.userId);
  }

  @Post('dashboard-link')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Open my Stripe Express dashboard',
    description:
      'A single-use link to the chef’s own Stripe dashboard (balance, payouts, bank ' +
      'account). Meant for the end of onboarding: the frontend calls it once ' +
      '`detailsSubmitted` is true and redirects the chef there.',
  })
  @ApiOkResponse({ type: StripeConnectLinkDto, description: 'Dashboard URL.' })
  @ApiConflictResponse({
    description:
      '`STRIPE_ONBOARDING_INCOMPLETE`, or no chef profile yet — complete ' +
      '`PATCH /me/chef-profile` first.',
  })
  @ApiClerkAuthResponses()
  createDashboardLink(
    @CurrentClerkUser() user: ClerkUser,
  ): Promise<StripeConnectLinkDto> {
    return this.stripeConnect.createDashboardLink(user.userId);
  }

  @Get('status')
  @ApiOperation({
    summary: 'Get my Stripe Connect onboarding status',
    description:
      'Flags mirrored from the Stripe `account.updated` webhook. Poll this while the ' +
      'chef completes onboarding.',
  })
  @ApiOkResponse({ type: StripeConnectStatusDto, description: 'Connect account state.' })
  @ApiConflictResponse({
    description: 'No chef profile yet — complete `PATCH /me/chef-profile` first.',
  })
  @ApiClerkAuthResponses()
  getStatus(@CurrentClerkUser() user: ClerkUser): Promise<StripeConnectStatusDto> {
    return this.stripeConnect.getStatus(user.userId);
  }
}
