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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

import { AdminGuard } from '../../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../../auth/current-clerk-user.decorator';
import { ApiAdminAuthResponses } from '../../../common/swagger/auth-responses';
import { TAGS } from '../../../common/swagger/tags';
import {
  ChefPayoutsQueryDto,
  MarkPayoutsPaidDto,
  SearchPayoutChefsQueryDto,
} from '../dto/chef-payouts.dto';
import { BankReconciliationService } from './bank-reconciliation.service';
import { ChefPayoutsService } from './chef-payouts.service';
import { PayoutStatementsService } from './payout-statements.service';

const CHEF_ID = '0e6f7a52-3d0b-4c1e-9a55-2b7c9d1e4f60';

const FLOW =
  '« Prix net »: Labs Food Batchcooking SAS sells the prestation with VAT (10 %), ' +
  'collects CESU on its NAN and the URSSAF immediate advance, and pays the batch cooker ' +
  'HT − Labs Food part − CESU fee by bank transfer. Card payments are not listed: ' +
  'Stripe pays the chef.';

/** The console's « Versements aux batch cookers ». */
@ApiTags(TAGS.payments)
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard, AdminGuard)
@Controller('admin/payouts')
export class AdminChefPayoutsController {
  constructor(
    private readonly payouts: ChefPayoutsService,
    private readonly reconciliation: BankReconciliationService,
    private readonly statements: PayoutStatementsService,
  ) {}

  @Get('payable')
  @ApiAdminAuthResponses()
  @ApiOperation({
    summary: 'Every line still to pay, all batch cookers: the day’s export',
  })
  payable() {
    return this.payouts.payableLines();
  }

  @Get('statements/:id/download')
  @ApiAdminAuthResponses()
  @ApiOperation({
    summary: 'A 5-minute link to an autofacture and its relevé de versement',
  })
  @ApiNotFoundResponse({ description: '`STATEMENT_NOT_FOUND`.' })
  statementDownload(@Param('id', ParseUUIDPipe) id: string) {
    return this.statements.downloadForAdmin(id);
  }

  @Get('summary')
  @ApiAdminAuthResponses()
  @ApiOperation({
    summary: 'Payout totals of the day, for the tiles, the tab badge and the bell',
    description: FLOW,
  })
  @ApiOkResponse({
    example: {
      payableCents: 35373,
      payableChefs: 2,
      vatCents: 4182,
      marginCents: 6445,
      awaitingCents: 12000,
      lateChefs: 1,
      lateCents: 17600,
      lastReconciliation: { at: '2026-11-25T22:12:00.000Z', received: 2, matched: 2 },
      bankFeedConfigured: true,
    },
  })
  summary() {
    return this.payouts.summary();
  }

  @Get('chefs')
  @ApiAdminAuthResponses()
  @ApiOperation({ summary: 'Search the batch cookers to pay, the most to pay first' })
  searchChefs(@Query() query: SearchPayoutChefsQueryDto) {
    return this.payouts.searchChefs(query.q);
  }

  @Get('chefs/:id')
  @ApiAdminAuthResponses()
  @ApiOperation({
    summary: 'One batch cooker’s payouts: to pay, awaited, or paid, over a period',
    description: `${FLOW} Awaited lines are an estimate at today's rates; a payout freezes them when the money arrives.`,
  })
  @ApiParam({ name: 'id', description: 'The chef profile id.', example: CHEF_ID })
  @ApiNotFoundResponse({ description: 'No batch cooker with this id.' })
  chef(@Param('id', ParseUUIDPipe) id: string, @Query() query: ChefPayoutsQueryDto) {
    return this.payouts.chefPayouts(id, query.view ?? 'payable', {
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
  }

  @Post('chefs/:id/mark-paid')
  @ApiAdminAuthResponses()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'The transfer to this batch cooker is made: mark these payouts paid',
  })
  @ApiParam({ name: 'id', description: 'The chef profile id.', example: CHEF_ID })
  @ApiNotFoundResponse({ description: 'None of these payouts is still payable.' })
  @ApiConflictResponse({
    description:
      '`PAYOUT_STATEMENT_INCOMPLETE`: the batch cooker’s legal name, SIREN, address or VAT ' +
      'franchise is missing, so no autofacture can be issued (`missing` lists them).',
  })
  markPaid(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: MarkPayoutsPaidDto,
  ) {
    return this.payouts.markPaid(user.userId, id, body.payoutIds, body.reference);
  }

  @Post('reconcile')
  @ApiAdminAuthResponses()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      '« Rapprocher maintenant »: read the bank account and settle what it received',
    description:
      'A CESU transfer settles its declaration when its label carries the booking ' +
      'reference and its amount matches. Anything else is kept as an exception. ' +
      'Without bank credentials, `configured: false` and nothing is read.',
  })
  @ApiServiceUnavailableResponse({
    description: '`BANK_FEED_UNAVAILABLE`: the bank could not be read.',
  })
  reconcile(@CurrentClerkUser() user: ClerkUser) {
    return this.reconciliation.run(user.userId);
  }
}

/** The batch cooker's own payouts: what Labs Food owes and has paid them. */
@ApiTags(TAGS.payments)
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller('me/chef/payouts')
export class ChefOwnPayoutsController {
  constructor(private readonly payouts: ChefPayoutsService) {}

  @Get()
  @ApiOperation({
    summary: 'My payouts: TTC, VAT, HT, Labs Food part, CESU fee and net, per payment',
    description:
      '`payable`: received by Labs Food, transfer to come. `awaiting`: not received yet ' +
      '(estimate). `paid`: transferred, with the autofacture it is on.',
  })
  mine(@CurrentClerkUser() user: ClerkUser, @Query() query: ChefPayoutsQueryDto) {
    return this.payouts.myPayouts(user.userId, query.view ?? 'payable', {
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
  }
}

/** The batch cooker's own autofactures. */
@ApiTags(TAGS.payments)
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller('me/chef/payout-statements')
export class ChefPayoutStatementsController {
  constructor(private readonly statements: PayoutStatementsService) {}

  @Get()
  @ApiOperation({ summary: 'My autofactures and relevés de versement, newest first' })
  list(@CurrentClerkUser() user: ClerkUser) {
    return this.statements.listMine(user.userId);
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'A 5-minute link to one of my autofactures' })
  @ApiNotFoundResponse({ description: '`STATEMENT_NOT_FOUND`.' })
  download(@CurrentClerkUser() user: ClerkUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.statements.downloadForChef(user.userId, id);
  }
}
