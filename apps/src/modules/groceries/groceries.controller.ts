import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { ApiClerkAuthResponses } from '../../common/swagger/auth-responses';
import { TAGS } from '../../common/swagger/tags';
import {
  CancelGroceriesDto,
  ConfirmCardDto,
  StartCardDto,
  ContestLineDto,
  DecideLineDto,
  DisputeFaultDto,
  DisputeRecoveredDto,
  GroceriesNoticeDto,
  ReceiptUploadDto,
  StatementQueryDto,
  SubmitReceiptsDto,
} from './dto/groceries.dto';
import { GroceriesService } from './groceries.service';

const VIEW =
  ' Answers the groceries as `GET …/groceries` does: status, Budget, hold, message, ' +
  'receipts, lines, capture.';

/**
 * Recettes lot 6: the groceries paid apart. The client saves a card and answers the
 * message before the groceries; the batch cooker sends it and deposits the receipts;
 * Lab's Food arbitrates the contests and the chargebacks.
 */
@ApiBearerAuth()
@ApiTags(TAGS.missions)
@Controller()
@UseGuards(ClerkAuthGuard)
export class GroceriesController {
  constructor(private readonly groceries: GroceriesService) {}

  @Get([
    'me/bookings/:id/groceries',
    'chef-missions/:id/groceries',
    'admin/bookings/:id/groceries',
  ])
  @ApiOperation({
    summary: 'Where the groceries of a prestation stand',
    description:
      'For the client, the batch cooker or an admin. `applies: false` when the client ' +
      'shops. The card is never shown to the batch cooker; the e-mail delivery never ' +
      'to the client.',
  })
  @ApiClerkAuthResponses()
  view(@CurrentClerkUser() user: ClerkUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.groceries.view(user.userId, id);
  }

  @Post('me/bookings/:id/groceries/card')
  @ApiOperation({
    summary: 'Save a card for the groceries (Stripe Checkout, setup mode)',
    description:
      'Answers the `url` of the Stripe page that saves the card; back on `successUrl`, ' +
      'confirm with the page id. The first call records the proof of ' +
      'the mandate accepted by the booking box: model version and clauses, maximum (the ' +
      'Budget Courses), SHA-256 of the mandate PDF, IP and browser. `409 ' +
      'GROCERIES_NOT_APPLICABLE` when the batch cooker does not shop.',
  })
  @ApiConflictResponse({
    description: '`GROCERIES_NOT_APPLICABLE`, `GROCERY_CARD_LOCKED`.',
  })
  @ApiClerkAuthResponses()
  startCard(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: FastifyRequest,
    @Body() body: StartCardDto,
  ) {
    return this.groceries.startCard(
      user.userId,
      id,
      { ip: req.ip, userAgent: req.headers['user-agent'] ?? null },
      body,
    );
  }

  @Post('me/bookings/:id/groceries/card/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'The card form succeeded: save the card',
    description:
      'Only Stripe ids, the brand, the last 4 digits and the expiry are kept. Inside the ' +
      'lock (T-48h), the hold is placed at once.' +
      VIEW,
  })
  @ApiConflictResponse({
    description: '`GROCERY_SETUP_MISMATCH`, `GROCERY_CARD_NOT_SAVED`.',
  })
  @ApiClerkAuthResponses()
  confirmCard(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ConfirmCardDto,
  ) {
    return this.groceries.confirmCard(user.userId, id, body.sessionId);
  }

  @Post('me/bookings/:id/groceries/hold/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Try the refused hold again',
    description:
      'After authenticating (3-D Secure) or changing the card. Without a hold by noon ' +
      'the day before, the groceries are cancelled and the client shops.' +
      VIEW,
  })
  @ApiClerkAuthResponses()
  retryHold(@CurrentClerkUser() user: ClerkUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.groceries.retryHold(user.userId, id);
  }

  @Post('me/bookings/:id/groceries/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm the groceries (message before the groceries)',
    description: 'Also after the deadline, while the batch cooker waits.' + VIEW,
  })
  @ApiConflictResponse({ description: '`GROCERY_NOTHING_TO_CONFIRM`.' })
  @ApiClerkAuthResponses()
  confirm(@CurrentClerkUser() user: ClerkUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.groceries.confirm(user.userId, id);
  }

  @Post('me/bookings/:id/groceries/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel the groceries',
    description:
      'Until they are done. Before the lock, the mandate is revoked for free; after it, ' +
      'the prestation is kept and the client buys the final list: nothing is refunded. ' +
      'The hold is released; an unpaid prestation loses its forfait courses.' +
      VIEW,
  })
  @ApiConflictResponse({ description: '`GROCERY_CANCEL_CLOSED`.' })
  @ApiClerkAuthResponses()
  cancel(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CancelGroceriesDto,
  ) {
    return this.groceries.cancel(user.userId, id, body.reason);
  }

  @Post('me/bookings/:id/groceries/lines/:lineId/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Agree to reimburse a line without a receipt',
    description: VIEW,
  })
  @ApiClerkAuthResponses()
  approveLine(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
  ) {
    return this.groceries.approveLine(user.userId, id, lineId);
  }

  @Post('me/bookings/:id/groceries/lines/:lineId/contest')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Contest a line of the receipts',
    description:
      'Within 48 hours of the deposit. The line is charged, then refunded if Lab’s Food ' +
      'upholds the contest.' +
      VIEW,
  })
  @ApiConflictResponse({
    description: '`GROCERY_CONTEST_CLOSED`, `GROCERY_LINE_CONTESTED`.',
  })
  @ApiClerkAuthResponses()
  contest(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() body: ContestLineDto,
  ) {
    return this.groceries.contestLine(user.userId, id, lineId, body.reason);
  }

  @Get([
    'me/bookings/:id/groceries/receipts/:receiptId/url',
    'chef-missions/:id/groceries/receipts/:receiptId/url',
    'admin/bookings/:id/groceries/receipts/:receiptId/url',
  ])
  @ApiOperation({ summary: 'A receipt photo, for 5 minutes' })
  @ApiClerkAuthResponses()
  receiptUrl(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('receiptId', ParseUUIDPipe) receiptId: string,
  ) {
    return this.groceries.receiptUrl(user.userId, id, receiptId);
  }

  @Post('chef-missions/:id/groceries/notice')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send the message before the groceries (art. 8)',
    description:
      'In the application and by e-mail (Brevo). Once the hold is placed. The cancel ' +
      'deadline is never sooner than the console’s minimum notice; the server clock ' +
      'rules.' +
      VIEW,
  })
  @ApiConflictResponse({
    description:
      '`GROCERY_HOLD_MISSING` (`opensAt`), `GROCERY_RUN_TOO_EARLY` (`opensAt`), `GROCERY_NOTICE_SENT`.',
  })
  @ApiUnprocessableEntityResponse({
    description: '`GROCERY_DEADLINE_TOO_SOON` (`earliest`), `GROCERY_DEADLINE_INVALID`.',
  })
  @ApiClerkAuthResponses()
  notice(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: GroceriesNoticeDto,
  ) {
    return this.groceries.sendNotice(user.userId, id, body);
  }

  @Post('chef-missions/:id/groceries/receipts/upload-url')
  @ApiOperation({ summary: 'Where to upload a receipt photo (private bucket)' })
  @ApiClerkAuthResponses()
  receiptUpload(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReceiptUploadDto,
  ) {
    return this.groceries.receiptUploadUrl(user.userId, id, body);
  }

  @Post('chef-missions/:id/groceries/receipts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Deposit the receipts',
    description:
      'Once, within 24 hours of the purchase, after the client confirmed. A total above ' +
      'the Budget is refused: the gap stays with the batch cooker. Charged 24 hours ' +
      'later; replaces the free amount of « Courses faites » (lot 4).' +
      VIEW,
  })
  @ApiConflictResponse({
    description:
      '`GROCERY_NOT_CONFIRMED`, `GROCERY_RECEIPTS_SENT`, `GROCERY_RECEIPT_MISSING`.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      '`GROCERIES_ABOVE_MANDATE`, `GROCERY_RECEIPTS_LATE`, `GROCERY_RUN_TOO_EARLY`.',
  })
  @ApiClerkAuthResponses()
  receipts(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SubmitReceiptsDto,
  ) {
    return this.groceries.submitReceipts(user.userId, id, {
      receipts: body.receipts,
      lines: body.lines.map((line) => ({ ...line, receipt: line.receipt ?? null })),
      instantPayout: body.instantPayout,
    });
  }

  @Get('me/chef/groceries/statement')
  @ApiOperation({
    summary: 'My groceries reimbursements of a month',
    description: 'Never commissioned, never declared as earnings (DAC7).',
  })
  @ApiOkResponse({ description: 'The month, a row per prestation, and the totals.' })
  @ApiClerkAuthResponses()
  statement(@CurrentClerkUser() user: ClerkUser, @Query() query: StatementQueryDto) {
    return this.groceries.chefStatement(user.userId, query.month);
  }
}

@ApiBearerAuth()
@ApiTags(TAGS.adminBookings)
@Controller()
@UseGuards(ClerkAuthGuard, AdminGuard)
export class AdminGroceriesController {
  constructor(private readonly groceries: GroceriesService) {}

  @Post('admin/bookings/:id/groceries/lines/:lineId/decision')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Arbitrate a contested line',
    description:
      '`upheld`: left out of the capture, or refunded to the client and taken back from ' +
      'the batch cooker’s transfer once charged. `rejected`: it stands.',
  })
  @ApiClerkAuthResponses()
  decide(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() body: DecideLineDto,
  ) {
    return this.groceries.decideLine(user.userId, id, lineId, body);
  }

  @Get('admin/groceries')
  @ApiOperation({
    summary: 'The groceries of every prestation (payment purpose « courses »)',
    description:
      'Budget, hold, receipts, capture, refunds, open contests and chargebacks. 200 at ' +
      'most, the most recently changed first. `?status=` narrows it.',
  })
  @ApiClerkAuthResponses()
  runs(@Query('status') status?: string) {
    const allowed = [
      'awaiting_card',
      'card_saved',
      'hold_placed',
      'hold_failed',
      'notice_sent',
      'awaiting_client',
      'confirmed',
      'cancelled',
      'receipts_submitted',
      'captured',
      'settled',
    ];
    return this.groceries.listRuns(allowed.includes(status ?? '') ? status : undefined);
  }

  @Get('admin/groceries/disputes')
  @ApiOperation({ summary: 'Chargebacks on groceries, newest first' })
  @ApiClerkAuthResponses()
  disputes() {
    return this.groceries.listDisputes();
  }

  @Post('admin/groceries/disputes/:disputeId/fault')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Name who was at fault for a lost chargeback',
    description:
      'Lab’s Food bears it while the bank handles it. Then `chef`: the transfer is taken ' +
      'back; `client`: to recover by hand; `platform`: written off.',
  })
  @ApiConflictResponse({
    description: '`GROCERY_DISPUTE_OPEN`, `GROCERY_DISPUTE_DECIDED`.',
  })
  @ApiClerkAuthResponses()
  fault(
    @CurrentClerkUser() user: ClerkUser,
    @Param('disputeId', ParseUUIDPipe) disputeId: string,
    @Body() body: DisputeFaultDto,
  ) {
    return this.groceries.declareFault(user.userId, disputeId, body);
  }

  @Post('admin/groceries/disputes/:disputeId/recovered')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'The client paid a lost chargeback back' })
  @ApiClerkAuthResponses()
  recovered(
    @CurrentClerkUser() user: ClerkUser,
    @Param('disputeId', ParseUUIDPipe) disputeId: string,
    @Body() body: DisputeRecoveredDto,
  ) {
    return this.groceries.markRecovered(user.userId, disputeId, body.reference);
  }
}

/**
 * Brevo's transactional webhook (delivered, bounces), authenticated by the secret its
 * URL carries: Brevo signs nothing. Without `BREVO_WEBHOOK_TOKEN`, everything is refused.
 */
@ApiTags(TAGS.missions)
@Controller()
export class BrevoWebhookController {
  constructor(
    private readonly groceries: GroceriesService,
    private readonly config: ConfigService,
  ) {}

  @Post('webhooks/brevo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Brevo transactional events (delivery proof of the groceries message)',
  })
  async brevo(@Query('token') token: string | undefined, @Body() body: unknown) {
    const expected = this.config.get<string>('brevo.webhookToken');
    if (!expected || token !== expected) {
      throw new ForbiddenException({
        code: 'WEBHOOK_FORBIDDEN',
        message: 'Unknown webhook.',
      });
    }
    const events = Array.isArray(body) ? body : [body];
    let matched = 0;
    for (const event of events) {
      if (event && typeof event === 'object') {
        const { matched: hit } = await this.groceries.handleBrevoEvent(event as never);
        if (hit) matched += 1;
      }
    }
    return { received: events.length, matched };
  }
}
