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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiServiceUnavailableResponse,
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
import { UsersService } from '../users/users.service';
import {
  BackfillPaymentInvoicesDto,
  DocumentLinkDto,
  PaymentInvoiceBackfillResultDto,
  PaymentInvoiceDto,
} from './dto/payment-invoice.dto';
import { PaymentInvoicesService } from './payment-invoices.service';

/**
 * Facture A, read side: the client's invoices for their order and document spaces. The
 * chef the invoice was issued for sees the same list. Issued by the
 * `payment_intent.succeeded` webhook; the admin backfill only catches up the payments
 * settled before that.
 */
@ApiTags('Payments')
@ApiBearerAuth()
@Controller()
@UseGuards(ClerkAuthGuard)
export class PaymentInvoicesController {
  constructor(
    private readonly invoices: PaymentInvoicesService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  @Get('me/payment-invoices')
  @ApiOperation({
    summary: 'List my invoices',
    description:
      'Invoices (facture A) for card payments, newest first: one per payment, issued in ' +
      "the chef's name the moment the card is charged. A client sees the invoices " +
      'addressed to them; a chef sees those issued for them. `bookingId` narrows the list ' +
      'to one order. Payments settled before invoices existed have none until an admin ' +
      'runs the backfill.',
  })
  @ApiQuery({ name: 'bookingId', required: false, format: 'uuid' })
  @ApiOkResponse({ type: PaymentInvoiceDto, isArray: true })
  @ApiClerkAuthResponses()
  list(
    @CurrentClerkUser() user: ClerkUser,
    @Query('bookingId', new ParseUUIDPipe({ optional: true })) bookingId?: string,
  ): Promise<PaymentInvoiceDto[]> {
    return this.invoices.listMine(user.userId, bookingId);
  }

  @Get('me/payment-invoices/:id/download-url')
  @ApiOperation({
    summary: 'Get a download link for one of my invoices',
    description:
      'A signed link valid 5 minutes, served as an attachment named ' +
      '`facture-<number>.pdf`. When the PDF is not stored yet (`pdfReady: false`) it is ' +
      'drawn and stored first, so this call can take a second longer.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: DocumentLinkDto })
  @ApiNotFoundResponse({
    description: '`INVOICE_NOT_FOUND`: no such invoice, or not one of yours.',
  })
  @ApiServiceUnavailableResponse({
    description: '`DOCUMENT_STORAGE_UNAVAILABLE`: storage refused the file. Retry.',
  })
  @ApiClerkAuthResponses()
  downloadUrl(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DocumentLinkDto> {
    return this.invoices.downloadUrl(user.userId, id);
  }

  @Post('admin/payment-invoices/backfill')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Admin: issue the invoices of card payments settled without one',
    description:
      'Catch-up for card payments settled before facture A existed. **A dry run unless ' +
      '`dryRun: false`**: an invoice is a legal document that can never be withdrawn, so ' +
      'the default only counts. Issued oldest payment first, each in its own transaction, ' +
      "dated today and numbered in this year's sequence, with the real payment date on " +
      'the PDF. A payment that cannot be invoiced is listed in `failed` and the run goes ' +
      'on; running it again issues only what is still missing. Audited.',
  })
  @ApiOkResponse({ type: PaymentInvoiceBackfillResultDto })
  @ApiAdminAuthResponses()
  async backfill(
    @Body() payload: BackfillPaymentInvoicesDto,
    @CurrentClerkUser() user: ClerkUser,
  ): Promise<PaymentInvoiceBackfillResultDto> {
    const result = await this.invoices.backfill(payload.dryRun ?? true);
    if (!result.dryRun) {
      const admin = await this.users.ensurePersistedFromClerk(user.userId);
      await this.audit.record({
        actorType: 'admin',
        actorUserId: admin.id,
        action: 'payment_invoice.backfilled',
        subjectType: 'payment_invoice',
        metadata: { issued: result.issued.length, failed: result.failed.length },
      });
    }
    return result;
  }
}
