import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';

import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import {
  ApiAdminAuthResponses,
  ApiClerkAuthResponses,
} from '../../common/swagger/auth-responses';
import type { CesuSettlementStatus } from '../../generated/prisma/client';
import { CesuPaymentsService } from './cesu-payments.service';
import {
  BookingPaymentStatusDto,
  CesuPaymentDto,
  CesuProofDto,
  CesuProofUploadDto,
  ChefCesuInfoDto,
  DeclareCesuPaymentDto,
  ForceSettleCesuPaymentDto,
  RejectCesuPaymentDto,
} from './dto/cesu.dto';

const PROOF_LINK_EXAMPLE = {
  url: 'https://<project>.supabase.co/storage/v1/object/sign/labsfood-kyc/cesu-proofs/…?token=…',
  expiresAt: '2026-10-14T10:05:00.000Z',
};

const CIRCUIT_NOTE =
  'Prefinanced CESU: **the funds never transit through the platform**. The client pays ' +
  "from their issuer's beneficiary area (Pluxee, Edenred, UP, BIMPLI, Domiserve) using " +
  'the chef CRCESU number (NAN), and the issuer credits the chef directly. No issuer ' +
  'exposes an API and no transaction reference is normalised, so nothing here can be ' +
  'verified programmatically — **the chef confirms**, being the party who receives both ' +
  "the issuer's notification and the money.";

/**
 * Public route, deliberately without `ClerkAuthGuard` at class level. Adding it here
 * would force the guard onto every other method individually, where one missed decorator
 * silently exposes a protected route — the same split as `PublicUsersController`.
 */
@ApiTags('Payments')
@Controller('chefs')
export class PublicCesuController {
  constructor(private readonly cesu: CesuPaymentsService) {}

  @Get(':chefProfileId/cesu-info')
  @ApiOperation({
    summary: 'Public: how to pay this chef in prefinanced CESU',
    description:
      `${CIRCUIT_NOTE} The NAN is therefore needed **before** any payment exists — a ` +
      'client who does not have it cannot add the chef as an intervenant on their portal ' +
      'at all. Invoice A cannot carry it either: it is only issued once the service has ' +
      'been delivered. Published only for a chef who has opted in and holds a NAN.',
  })
  @ApiParam({ name: 'chefProfileId', description: 'Chef profile uuid.' })
  @ApiOkResponse({
    type: ChefCesuInfoDto,
    description: 'CESU payment details for a chef.',
  })
  @ApiNotFoundResponse({
    description: 'No such chef, or the chef is not open for bookings.',
  })
  getChefCesuInfo(
    @Param('chefProfileId', ParseUUIDPipe) chefProfileId: string,
  ): Promise<ChefCesuInfoDto> {
    return this.cesu.getChefCesuInfo(chefProfileId);
  }
}

@ApiTags('Payments')
@ApiBearerAuth()
@Controller()
@UseGuards(ClerkAuthGuard)
export class CesuPaymentsController {
  constructor(private readonly cesu: CesuPaymentsService) {}

  @Post('payments/cesu')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({ register: true })
  @ApiOperation({
    summary: 'Declare a prefinanced CESU payment on a booking',
    description:
      `${CIRCUIT_NOTE} This route records the declaration; the payment stays \`pending\` ` +
      'until the chef confirms. The amount may not exceed what is left to cover on the ' +
      'booking (see `GET /me/bookings/:id/payment-status`) — CRCESU rules forbid charging ' +
      'the client anything on top, so no fee can be added on this path. A booking may be ' +
      'paid part CESU and part card.\n\n' +
      '**e-CESU needs its proof**: upload the issuer’s confirmation first (`POST ' +
      '/me/bookings/{id}/cesu-proof/upload-url`, then a `PUT` of the file) and send its ' +
      '`proofUploadId` here. It is Lab’s Food’s evidence in a dispute; the chef still ' +
      'confirms receipt.',
  })
  @ApiOkResponse({ type: CesuPaymentDto, description: 'The recorded declaration.' })
  @ApiNotFoundResponse({ description: 'Booking not found or not owned by the caller.' })
  @ApiUnprocessableEntityResponse({
    description:
      '`PROOF_MISSING`: no file arrived for `proofUploadId`; or not a PDF or image.',
  })
  @ApiConflictResponse({
    description:
      'Booking is not `pending` or already fully paid; the amount exceeds what is due; ' +
      'the chef is not admin-verified, does not accept CESU, or has an uncollected ' +
      'commission; or a CESU declaration is already open on this booking.',
  })
  @ApiClerkAuthResponses()
  declare(
    @CurrentClerkUser() user: ClerkUser,
    @Body() payload: DeclareCesuPaymentDto,
  ): Promise<CesuPaymentDto> {
    return this.cesu.declare(user.userId, payload);
  }

  @Post('me/bookings/:id/cesu-proof/upload-url')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Upload my e-CESU proof, step 1: get an upload link',
    description:
      'Before declaring an e-CESU payment: the issuer’s confirmation (PDF, JPEG, PNG or ' +
      'WebP, 10 MB at most). `PUT` the file to `url` with the `headers` given, then send ' +
      'the `uploadId` as `proofUploadId` to `POST /payments/cesu`. The file goes to a ' +
      'private store: nobody gets a public link to it.',
  })
  @ApiParam({ name: 'id', description: 'Booking uuid.' })
  @ApiCreatedResponse({
    description: 'Where to send the file.',
    example: {
      uploadId: 'up_9f2a1c4e7b30d85a61c2e4f7',
      method: 'PUT',
      url: 'https://<project>.supabase.co/storage/v1/object/upload/sign/labsfood-kyc/…',
      headers: { 'Content-Type': 'application/pdf' },
      expiresAt: '2026-10-14T12:00:00.000Z',
    },
  })
  @ApiNotFoundResponse({ description: 'Booking not found or not owned by the caller.' })
  @ApiConflictResponse({ description: 'The booking cannot be paid now.' })
  @ApiClerkAuthResponses()
  proofUploadUrl(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) bookingId: string,
    @Body() payload: CesuProofUploadDto,
  ) {
    return this.cesu.proofUploadUrl(user.userId, bookingId, payload);
  }

  @Put('me/cesu-payments/:id/proof')
  @ApiOperation({
    summary: 'Replace my e-CESU proof',
    description:
      'A wrong file, replaced by another uploaded the same way (step 1 above), while the ' +
      'chef has not answered. Once they confirmed or rejected, the proof is kept as it is.',
  })
  @ApiParam({ name: 'id', description: 'Payment uuid.' })
  @ApiOkResponse({ type: CesuPaymentDto, description: 'The declaration.' })
  @ApiNotFoundResponse({ description: 'No such CESU payment of mine.' })
  @ApiConflictResponse({ description: '`PROOF_LOCKED`: the chef has answered.' })
  @ApiUnprocessableEntityResponse({
    description: '`PROOF_MISSING`, or not a PDF or image.',
  })
  @ApiClerkAuthResponses()
  replaceProof(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) paymentId: string,
    @Body() payload: CesuProofDto,
  ): Promise<CesuPaymentDto> {
    return this.cesu.replaceProof(user.userId, paymentId, payload.uploadId);
  }

  @Get('me/cesu-payments/:id/proof-url')
  @ApiOperation({
    summary: 'See my e-CESU proof',
    description: 'A link valid 5 minutes.',
  })
  @ApiParam({ name: 'id', description: 'Payment uuid.' })
  @ApiOkResponse({ description: 'The link.', example: PROOF_LINK_EXAMPLE })
  @ApiNotFoundResponse({ description: 'No such CESU payment of mine, or `NO_PROOF`.' })
  @ApiClerkAuthResponses()
  proofUrl(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) paymentId: string,
  ) {
    return this.cesu.proofUrl(user.userId, paymentId);
  }

  @Get('me/bookings/:id/payment-status')
  @ApiOperation({
    summary: 'How much is left to pay on my booking',
    description:
      'Coverage counts **settled payments only**, which is what lets a booking be split ' +
      'between CESU and card: it becomes `confirmed` when the parts add up. Also carries ' +
      'the chef CRCESU number, needed before paying in CESU.',
  })
  @ApiParam({ name: 'id', description: 'Booking uuid.' })
  @ApiOkResponse({ type: BookingPaymentStatusDto, description: 'Amount left to pay.' })
  @ApiNotFoundResponse({ description: 'Booking not found or not owned by the caller.' })
  @ApiClerkAuthResponses()
  paymentStatus(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) bookingId: string,
  ): Promise<BookingPaymentStatusDto> {
    return this.cesu.getBookingPaymentStatus(user.userId, bookingId);
  }

  @Get('me/chef/cesu-payments')
  @ApiOperation({
    summary: 'Chef: CESU payments declared on my bookings',
    description:
      'Newest first. A `declared` entry is waiting for you to confirm or reject it.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['declared', 'confirmed', 'rejected'],
    description: 'Filter by settlement status.',
  })
  @ApiOkResponse({ type: CesuPaymentDto, isArray: true, description: 'Declarations.' })
  @ApiConflictResponse({ description: 'No chef profile yet.' })
  @ApiClerkAuthResponses()
  listMine(
    @CurrentClerkUser() user: ClerkUser,
    @Query('status') status?: CesuSettlementStatus,
  ): Promise<CesuPaymentDto[]> {
    return this.cesu.listForChef(user.userId, status);
  }

  @Post('me/chef/cesu-payments/:id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Chef: confirm a CESU payment was received',
    description:
      'The only settlement signal that exists for CESU. Settles the payment, confirms the ' +
      'booking once the payments cover it, and makes the commission due — which, with the ' +
      'default `on_payment` trigger, issues your commission invoice and starts its SEPA ' +
      'direct debit straight away.',
  })
  @ApiParam({ name: 'id', description: 'Payment uuid.' })
  @ApiOkResponse({ type: CesuPaymentDto, description: 'The confirmed payment.' })
  @ApiNotFoundResponse({ description: 'No such CESU payment.' })
  @ApiForbiddenResponse({ description: 'The payment belongs to another chef.' })
  @ApiConflictResponse({ description: 'Already confirmed or rejected.' })
  @ApiClerkAuthResponses()
  confirm(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) paymentId: string,
  ): Promise<CesuPaymentDto> {
    return this.cesu.confirm(user.userId, paymentId);
  }

  @Post('me/chef/cesu-payments/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Chef: report that a declared CESU payment never arrived',
    description:
      'Fails the payment and its commission. The booking stays `pending`, so the client ' +
      'can pay again by any method.',
  })
  @ApiParam({ name: 'id', description: 'Payment uuid.' })
  @ApiOkResponse({ type: CesuPaymentDto, description: 'The rejected payment.' })
  @ApiNotFoundResponse({ description: 'No such CESU payment.' })
  @ApiForbiddenResponse({ description: 'The payment belongs to another chef.' })
  @ApiConflictResponse({ description: 'Already confirmed or rejected.' })
  @ApiClerkAuthResponses()
  reject(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) paymentId: string,
    @Body() payload: RejectCesuPaymentDto,
  ): Promise<CesuPaymentDto> {
    return this.cesu.reject(user.userId, paymentId, payload.reason);
  }

  @Get('admin/cesu-payments')
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Admin: every CESU declaration',
    description:
      'Newest first. Filter with `status` to triage what chefs have not answered.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['declared', 'confirmed', 'rejected'],
  })
  @ApiOkResponse({ type: CesuPaymentDto, isArray: true, description: 'Declarations.' })
  @ApiAdminAuthResponses()
  listAll(@Query('status') status?: CesuSettlementStatus): Promise<CesuPaymentDto[]> {
    return this.cesu.listForAdmin(status);
  }

  @Get('admin/cesu-payments/:id/proof-url')
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Admin: see the client’s e-CESU proof',
    description: 'For a dispute between a chef and a client. A link valid 5 minutes.',
  })
  @ApiParam({ name: 'id', description: 'Payment uuid.' })
  @ApiOkResponse({ description: 'The link.', example: PROOF_LINK_EXAMPLE })
  @ApiNotFoundResponse({ description: 'No such CESU payment, or `NO_PROOF`.' })
  @ApiAdminAuthResponses()
  adminProofUrl(@Param('id', ParseUUIDPipe) paymentId: string) {
    return this.cesu.adminProofUrl(paymentId);
  }

  @Post('admin/cesu-payments/:id/force-settle')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Admin: settle a CESU payment in the chef place',
    description:
      'Support path for an unresponsive chef. **A proof reference is mandatory**: this ' +
      "writes a tax-credit line in a chef's name without that chef confirming anything, " +
      'so the admin identity and the evidence are both recorded on the settlement.',
  })
  @ApiParam({ name: 'id', description: 'Payment uuid.' })
  @ApiOkResponse({ type: CesuPaymentDto, description: 'The settled payment.' })
  @ApiNotFoundResponse({ description: 'No such CESU payment.' })
  @ApiConflictResponse({ description: 'Already confirmed or rejected.' })
  @ApiAdminAuthResponses()
  forceSettle(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) paymentId: string,
    @Body() payload: ForceSettleCesuPaymentDto,
  ): Promise<CesuPaymentDto> {
    return this.cesu.forceSettle(user.userId, paymentId, payload.proofRef);
  }
}
