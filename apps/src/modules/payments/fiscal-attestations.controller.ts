import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
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
import {
  ApiAdminAuthResponses,
  ApiClerkAuthResponses,
} from '../../common/swagger/auth-responses';
import { FiscalAttestationDto } from './dto/payment.dto';
import { FiscalAttestationsService } from './fiscal-attestations.service';

const ATTESTATION_DESCRIPTION =
  'Amounts eligible for the 50 % "service à la personne" tax credit across succeeded ' +
  'payments of the year (refunded payments drop out automatically), broken down by ' +
  'issuing chef in `providers`. **The chef is the declared provider (prestataire)**, so ' +
  'one attestation is issued per entry in `providers`, carrying that chef NOVA code or ' +
  'cooperative; the client-level totals are a dashboard summary, not a filable document. ' +
  'A provider with `sapDeclared: false` has not declared a SAP route and cannot issue one. ' +
  'JSON only — the rendered PDF is a separate deliverable, pending the legal template.';

@ApiTags('payments')
@ApiBearerAuth()
@Controller()
@UseGuards(ClerkAuthGuard)
export class FiscalAttestationsController {
  constructor(private readonly attestations: FiscalAttestationsService) {}

  @Get('me/fiscal-attestations/:year')
  @ApiOperation({
    summary: 'Get my tax-credit total for a year',
    description: ATTESTATION_DESCRIPTION,
  })
  @ApiParam({ name: 'year', description: 'Calendar year.', example: 2026 })
  @ApiOkResponse({
    type: FiscalAttestationDto,
    description: 'Yearly total for the caller.',
  })
  @ApiClerkAuthResponses()
  getMine(
    @CurrentClerkUser() user: ClerkUser,
    @Param('year', ParseIntPipe) year: number,
  ): Promise<FiscalAttestationDto> {
    return this.attestations.summarizeForClerkUser(user.userId, year);
  }

  @Get('admin/fiscal-attestations')
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Admin: tax-credit totals for every client',
    description: `${ATTESTATION_DESCRIPTION} Clients with no succeeded payment that year are omitted.`,
  })
  @ApiQuery({
    name: 'year',
    required: false,
    description: 'Calendar year. Defaults to the current year.',
    example: 2026,
  })
  @ApiOkResponse({
    type: FiscalAttestationDto,
    isArray: true,
    description: 'One row per client, largest total first.',
  })
  @ApiAdminAuthResponses()
  listAll(@Query('year') year?: string): Promise<FiscalAttestationDto[]> {
    return this.attestations.summarizeAllClients(resolveYear(year));
  }

  @Get('admin/fiscal-attestations/:clientId')
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Admin: tax-credit total for one client',
    description: ATTESTATION_DESCRIPTION,
  })
  @ApiParam({ name: 'clientId', description: 'Postgres `users.id` of the client.' })
  @ApiQuery({
    name: 'year',
    required: false,
    description: 'Calendar year. Defaults to the current year.',
    example: 2026,
  })
  @ApiOkResponse({
    type: FiscalAttestationDto,
    description: 'Yearly total for the client.',
  })
  @ApiNotFoundResponse({ description: 'Client not found.' })
  @ApiAdminAuthResponses()
  getForClient(
    @Param('clientId') clientId: string,
    @Query('year') year?: string,
  ): Promise<FiscalAttestationDto> {
    return this.attestations.summarizeForClientId(clientId, resolveYear(year));
  }
}

function resolveYear(raw?: string): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : new Date().getUTCFullYear();
}
