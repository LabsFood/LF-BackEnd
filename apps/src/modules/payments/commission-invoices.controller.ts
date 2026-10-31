import {
  Body,
  ConflictException,
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
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { AuditService } from '../../common/audit/audit.service';
import {
  ApiAdminAuthResponses,
  ApiClerkAuthResponses,
} from '../../common/swagger/auth-responses';
import type { CommissionInvoiceStatus } from '../../generated/prisma/client';
import { UsersService } from '../users/users.service';
import {
  CommissionDebitsService,
  type CommissionInvoiceView,
} from './commission-debits.service';
import {
  CommissionInvoiceDto,
  RunDueInvoicesResultDto,
} from './dto/commission-invoice.dto';
import { RunDueInvoicesDto } from './dto/cesu.dto';

const INVOICE_NOTE =
  'Facture B — the commission invoice the platform issues to the chef, and the legal ' +
  'basis of the SEPA direct debit. The invoice always precedes the debit. A failed debit ' +
  'does **not** cancel it: the receivable survives the attempt, which is why a retry ' +
  'reuses the same number and the sequence never develops holes. This phase delivers the ' +
  'numbered receivable and its JSON; the rendered PDF and the 10-year S3 archive belong ' +
  'to the invoicing workstream.';

@ApiTags('Payments')
@ApiBearerAuth()
@Controller()
@UseGuards(ClerkAuthGuard)
export class CommissionInvoicesController {
  constructor(
    private readonly commissionDebits: CommissionDebitsService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  @Get('me/chef/commission-invoices')
  @ApiOperation({
    summary: 'Chef: my commission invoices and their direct debits',
    description:
      `${INVOICE_NOTE} A card booking's commission never appears here as an outstanding ` +
      'amount — Stripe withholds it at charge time.',
  })
  @ApiOkResponse({
    type: CommissionInvoiceDto,
    isArray: true,
    description: 'Invoices, newest first.',
  })
  @ApiConflictResponse({ description: 'No chef profile yet.' })
  @ApiClerkAuthResponses()
  async listMine(@CurrentClerkUser() user: ClerkUser): Promise<CommissionInvoiceDto[]> {
    const chef = await this.users.requireOwnChefProfile(user.userId);
    const invoices = await this.commissionDebits.listInvoicesForChef(chef.id);
    return invoices.map(toCommissionInvoiceDto);
  }

  @Get('admin/commission-invoices')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Admin: every commission invoice', description: INVOICE_NOTE })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['issued', 'settled', 'written_off'],
    description: '`issued` is what is still due.',
  })
  @ApiOkResponse({
    type: CommissionInvoiceDto,
    isArray: true,
    description: 'Invoices, newest first.',
  })
  @ApiAdminAuthResponses()
  async listAll(
    @Query('status') status?: CommissionInvoiceStatus,
  ): Promise<CommissionInvoiceDto[]> {
    const invoices = await this.commissionDebits.listInvoicesForAdmin(status);
    return invoices.map(toCommissionInvoiceDto);
  }

  // ponytail: no cron scheduler — this endpoint is the trigger for `monthly_batch`.
  // Add one (Railway cron, or a scheduled job) when the manual trigger stops being enough.
  @Post('admin/commission-invoices/run-due')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Admin: invoice and debit the commissions due for a period',
    description:
      'The `monthly_batch` half of `PAYMENTS_COMMISSION_DEBIT_TRIGGER`: groups every ' +
      'still-pending direct-debit commission into one invoice per chef, then debits each. ' +
      'Debits are spread across the allowed `target_date` range so a busy month does not ' +
      'land as one transaction against the 10 000 EUR SEPA ceiling. Held under a Postgres ' +
      'advisory lock — Railway can run several instances, and a second concurrent run ' +
      'returns `skippedBecauseLocked` rather than double-invoicing. **There is no ' +
      'scheduler in this phase**: this endpoint is the trigger.',
  })
  @ApiOkResponse({ type: RunDueInvoicesResultDto, description: 'What the run did.' })
  @ApiAdminAuthResponses()
  async runDue(@Body() payload: RunDueInvoicesDto): Promise<RunDueInvoicesResultDto> {
    const period = resolvePeriod(payload);
    const result = await this.commissionDebits.runDueInvoices(period);
    return {
      invoicesIssued: result.invoicesIssued,
      debitsStarted: result.debitsStarted,
      invoiceNumbers: result.invoiceNumbers,
      skippedBecauseLocked: result.skipped === 'locked',
    };
  }

  @Post('admin/commission-invoices/:id/retry-debit')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Admin: retry the direct debit on a commission invoice',
    description:
      'Runs another attempt against the same invoice — the number is kept, so no hole ' +
      'appears in the sequence. Unlike the automatic attempts, an admin retry may go past ' +
      '`PAYMENTS_COMMISSION_DEBIT_MAX_ATTEMPTS`: it is the human decision that lifts the ' +
      'commission block. It is refused (`DEBIT_NOT_POSSIBLE`) while the chef has no active ' +
      'mandate, so a retry never adds a failed attempt for nothing. An attempt interrupted ' +
      'before Stripe answered is replayed with its original idempotency key. Audited.',
  })
  @ApiParam({ name: 'id', description: 'Commission invoice uuid.' })
  @ApiOkResponse({
    description: 'The debit attempt that was started.',
    example: {
      id: '6a2f9e14-0b7c-4d3a-8e51-9c0d2b4f6a11',
      commissionInvoiceId: '1f0e2d3c-4b5a-4987-8a6b-5c4d3e2f1a00',
      stripePaymentIntentId: 'pi_3Q8xYzAbCdEf',
      amountTtcCents: 4200,
      status: 'processing',
      attemptNumber: 2,
      failureReason: null,
      initiatedAt: '2026-10-17T09:12:03.412Z',
      settledAt: null,
      clawbackWindowEndsAt: null,
      createdAt: '2026-10-17T09:12:02.980Z',
      updatedAt: '2026-10-17T09:12:03.412Z',
    },
  })
  @ApiNotFoundResponse({ description: 'No such commission invoice.' })
  @ApiConflictResponse({
    description:
      '`INVOICE_NOT_ISSUED`, `DEBIT_IN_PROGRESS`, or `DEBIT_NOT_POSSIBLE` (no active ' +
      'mandate, or an amount SEPA refuses).',
  })
  @ApiAdminAuthResponses()
  async retryDebit(
    @Param('id', ParseUUIDPipe) invoiceId: string,
    @CurrentClerkUser() user: ClerkUser,
  ) {
    // Same engine as the first attempt: the invoice keeps its number, so a retry never
    // burns one nor leaves a hole in the sequence.
    const debit = await this.commissionDebits.executeDebit(invoiceId, {
      overrideAttemptCeiling: true,
    });
    // Going past the ceiling lifts a block on a chef: who decided it must be answerable.
    const admin = await this.users.ensurePersistedFromClerk(user.userId);
    await this.audit.record({
      actorType: 'admin',
      actorUserId: admin.id,
      action: 'commission.debit_retried',
      subjectType: 'commission_invoice',
      subjectId: invoiceId,
      metadata: { attemptNumber: debit.attemptNumber, status: debit.status },
    });
    return debit;
  }
}

function toCommissionInvoiceDto(invoice: CommissionInvoiceView): CommissionInvoiceDto {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    chefProfileId: invoice.chefProfileId,
    chefDisplayName: invoice.chefProfile?.displayName ?? null,
    issuedAt: invoice.issuedAt,
    amountHtCents: invoice.amountHtCents,
    amountVatCents: invoice.amountVatCents,
    amountTtcCents: invoice.amountTtcCents,
    rateBps: invoice.rateBps,
    vatRateBps: invoice.vatRateBps,
    paymentMethod: invoice.paymentMethod,
    collectionMethod: invoice.collectionMethod,
    status: invoice.status,
    periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd,
    commissionsCount: invoice._count.commissions,
    debits: invoice.debits.map((debit) => ({
      id: debit.id,
      status: debit.status,
      attemptNumber: debit.attemptNumber,
      amountTtcCents: debit.amountTtcCents,
      failureReason: debit.failureReason,
      initiatedAt: debit.initiatedAt,
      settledAt: debit.settledAt,
      clawbackWindowEndsAt: debit.clawbackWindowEndsAt,
    })),
  };
}

/** Defaults to the previous calendar month, the window a monthly batch is meant to bill. */
function resolvePeriod(payload: RunDueInvoicesDto): { start: Date; end: Date } {
  const now = new Date();
  const start = payload.periodStart
    ? new Date(payload.periodStart)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = payload.periodEnd
    ? new Date(payload.periodEnd)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    throw new ConflictException('`periodStart` must be a valid date before `periodEnd`.');
  }
  return { start, end };
}
