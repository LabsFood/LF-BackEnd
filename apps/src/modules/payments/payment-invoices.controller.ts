import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
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

import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { ApiClerkAuthResponses } from '../../common/swagger/auth-responses';
import { DocumentLinkDto, PaymentInvoiceDto } from './dto/payment-invoice.dto';
import { PaymentInvoicesService } from './payment-invoices.service';

/**
 * Facture A, read side: the client's invoices for their order and document spaces. The
 * chef the invoice was issued for sees the same list. Issued by the
 * `payment_intent.succeeded` webhook, never from here.
 */
@ApiTags('Payments')
@ApiBearerAuth()
@Controller('me/payment-invoices')
@UseGuards(ClerkAuthGuard)
export class PaymentInvoicesController {
  constructor(private readonly invoices: PaymentInvoicesService) {}

  @Get()
  @ApiOperation({
    summary: 'List my invoices',
    description:
      'Invoices (facture A) for card payments, newest first: one per payment, issued in ' +
      "the chef's name the moment the card is charged. A client sees the invoices " +
      'addressed to them; a chef sees those issued for them. `bookingId` narrows the list ' +
      'to one order. Payments settled before invoices existed have none.',
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

  @Get(':id/download-url')
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
}
