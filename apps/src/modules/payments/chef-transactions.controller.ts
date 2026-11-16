import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { ApiAdminAuthResponses } from '../../common/swagger/auth-responses';
import { TAGS } from '../../common/swagger/tags';
import { ChefTransactionsService } from './chef-transactions.service';
import { CollectCommissionsDto } from './dto/chef-transactions.dto';

const CHEF_ID = '0e6f7a52-3d0b-4c1e-9a55-2b7c9d1e4f60';
const COMMISSION_ID = '5c1ebc99-9c0b-4ef8-bb6d-6bb9bd380a77';

const requestId = (req: { id?: unknown }) =>
  typeof req.id === 'string' ? req.id : undefined;

/** A batch cooker's payments and commissions, and the manual commission debit. */
@ApiTags(TAGS.payments)
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard, AdminGuard)
@Controller('admin/chefs')
export class AdminChefTransactionsController {
  constructor(private readonly transactions: ChefTransactionsService) {}

  @Get(':id/transactions')
  @ApiOperation({
    summary: 'A batch cooker’s transactions summary',
    description:
      'Every payment on their bookings (newest 200) with the commission taken on it, ' +
      'its facture B and last debit. Commissions `collectable` now come first. `totals` ' +
      'sums the commissions per status, and what can be collected.',
  })
  @ApiParam({ name: 'id', description: 'The chef profile id.', example: CHEF_ID })
  @ApiOkResponse({
    description: 'The summary.',
    example: {
      chefProfileId: CHEF_ID,
      totals: {
        byStatus: { pending: { count: 1, amountTtcCents: 3240 } },
        collectable: { count: 1, amountTtcCents: 3240 },
      },
      transactions: [
        {
          paymentId: '7f1ebc99-9c0b-4ef8-bb6d-6bb9bd380a44',
          method: 'avance_immediate',
          purpose: 'service',
          status: 'succeeded',
          amountCents: 18000,
          createdAt: '2026-11-22T09:12:00.000Z',
          paidAt: '2026-11-26T10:00:00.000Z',
          urssafReference: null,
          externalReference: 'UNI-2026-000123',
          booking: {
            id: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
            reference: 'LF-SM-2026-0001',
            startsAt: '2026-11-21T10:00:00.000Z',
            clientName: 'Sophie Marchand',
          },
          commission: {
            id: COMMISSION_ID,
            status: 'pending',
            collectionMethod: 'sepa_direct_debit',
            amountTtcCents: 3240,
            collectable: true,
            invoice: null,
            lastDebit: null,
          },
        },
      ],
    },
  })
  @ApiNotFoundResponse({ description: 'No batch cooker with this id.' })
  @ApiAdminAuthResponses()
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.transactions.transactions(id);
  }

  @Post(':id/commissions/collect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Collect commissions by SEPA debit',
    description:
      'Bills the chosen commissions on one facture B and starts its SEPA debit on the ' +
      'batch cooker’s mandate. The debit then follows the usual Stripe webhooks. ' +
      'Audited (`commission.collect_manual`).',
  })
  @ApiParam({ name: 'id', description: 'The chef profile id.', example: CHEF_ID })
  @ApiOkResponse({
    description:
      'The invoice and the debit attempt. A debit Stripe refused comes back ' +
      '`failed` with its `failureReason`; the invoice stays due.',
    example: {
      invoice: {
        id: '1d2ebc99-9c0b-4ef8-bb6d-6bb9bd380a88',
        invoiceNumber: 'LF-COM-2026-0001',
        amountTtcCents: 3240,
      },
      debit: {
        id: '2e3ebc99-9c0b-4ef8-bb6d-6bb9bd380a99',
        status: 'processing',
        failureReason: null,
      },
    },
  })
  @ApiConflictResponse({
    description:
      '`COMMISSION_NOT_COLLECTABLE` (`commissionIds` lists the refused ones): another ' +
      'chef’s, already billed, not by direct debit, or on an unpaid prestation. ' +
      '`SEPA_MANDATE_INACTIVE`: no active mandate to debit.',
  })
  @ApiNotFoundResponse({ description: 'No batch cooker with this id.' })
  @ApiAdminAuthResponses()
  collect(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() payload: CollectCommissionsDto,
    @Req() req: { id?: unknown },
  ) {
    return this.transactions.collect(
      user.userId,
      id,
      payload.commissionIds,
      requestId(req),
    );
  }
}
