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
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiServiceUnavailableResponse,
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
import { TAGS } from '../../common/swagger/tags';
import { BookingPaymentsService } from './booking-payments.service';
import {
  DecideUrssafLinkDto,
  RequestUrssafLinkDto,
  SettleBookingDto,
  SimulateUrssafOutcomeDto,
  URSSAF_LINK_STATUSES,
  type UrssafLinkStatusKey,
} from './dto/booking-payments.dto';

const BOOKING_ID = 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';
const PAYMENT_ID = '7f1ebc99-9c0b-4ef8-bb6d-6bb9bd380a44';
const LINK_ID = '9a2ebc99-9c0b-4ef8-bb6d-6bb9bd380a55';
const CHEF_ID = '0e6f7a52-3d0b-4c1e-9a55-2b7c9d1e4f60';

const LINK_EXAMPLE = {
  id: LINK_ID,
  chefProfileId: CHEF_ID,
  chefName: 'Alice Martin',
  status: 'pending',
  refusalReason: null,
  requestedAt: '2026-10-13T09:00:00.000Z',
  decidedAt: null,
};

const requestId = (req: { id?: unknown }) =>
  typeof req.id === 'string' ? req.id : undefined;

/** What a client needs to pay a prestation: the choice, then the immediate advance. */
@ApiTags(TAGS.payments)
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller()
export class BookingPaymentsController {
  constructor(private readonly bookingPayments: BookingPaymentsService) {}

  @Get('me/bookings/:id/payment-options')
  @ApiOperation({
    summary: 'See how I can pay a prestation',
    description:
      'Everything the payment screen needs, in one call: where the payment stands, ' +
      'the amounts, and the methods **this client** can use with **this batch cooker**.\n\n' +
      '- `status`: `not-due` (the prestation has not taken place: it is paid afterwards), ' +
      '`due`, `processing` (waiting for the batch cooker to confirm CESU, or for ' +
      'URSSAF), `paid`, `failed` (the last attempt failed; it can be paid again).\n' +
      '- A method the batch cooker does not take is **not in the list**. One they take ' +
      'but that is blocked for this client is `available: false` with `reasonCode` and ' +
      'a `reason` to show as written.\n' +
      '- `dueNowCents` is what the client pays on the site with that method. For the ' +
      'immediate advance (`urssaf`) it is `0`: nothing is charged here, and ' +
      '`debitedLaterCents` is what URSSAF takes from their account afterwards.\n' +
      '- `urssaf` reason codes: `URSSAF_LINK_NONE` (offer `POST /me/urssaf-links`), ' +
      '`URSSAF_LINK_PENDING`, `URSSAF_LINK_REFUSED`.\n' +
      '- `cesu` carries `crcesuNan`, the number the client pays the batch cooker with ' +
      'on their issuer’s site.',
  })
  @ApiParam({ name: 'id', description: 'The booking id.', example: BOOKING_ID })
  @ApiOkResponse({
    description: 'The payment state, the amounts and the methods.',
    example: {
      bookingId: BOOKING_ID,
      reference: 'LF-SM-2026-0001',
      status: 'due',
      dueAt: '2026-10-05',
      amounts: {
        totalCents: 18000,
        paidCents: 0,
        remainingCents: 18000,
        taxCreditCents: 9000,
        currency: 'eur',
      },
      methods: [
        {
          id: 'urssaf',
          available: false,
          reasonCode: 'URSSAF_LINK_PENDING',
          reason: 'Votre demande de rattachement est en cours d’instruction.',
          dueNowCents: 0,
          debitedLaterCents: 9000,
        },
        { id: 'card', available: true, dueNowCents: 18000 },
        {
          id: 'cesu',
          available: true,
          dueNowCents: 18000,
          maxCesuCents: 18000,
          crcesuNan: '1234567*8',
        },
      ],
      savedCards: [],
    },
  })
  @ApiNotFoundResponse({ description: 'No booking of the caller with this id.' })
  @ApiClerkAuthResponses()
  options(@CurrentClerkUser() user: ClerkUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookingPayments.options(user.userId, id);
  }

  @Post('bookings/:id/settle')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({ register: true })
  @ApiOperation({
    summary: 'Pay a prestation with the immediate advance',
    description:
      'The client confirms the prestation took place. **Nothing is charged here**: the ' +
      'request goes to URSSAF, which takes the client’s share (the price less the 50 % ' +
      'tax credit) from their account and pays the batch cooker.\n\n' +
      'The answer never says "paid". The prestation is `processing` until URSSAF ' +
      'answers; if URSSAF refuses, it is `failed` and can be paid another way.\n\n' +
      'Needs an active enrolment of this client with this batch cooker ' +
      '(`POST /me/urssaf-links`).',
  })
  @ApiParam({ name: 'id', description: 'The booking id.', example: BOOKING_ID })
  @ApiOkResponse({
    description: 'The request is with URSSAF.',
    example: {
      paymentId: PAYMENT_ID,
      status: 'processing',
      debitedCents: 9000,
      transmittedAt: '2026-10-13T09:12:00.000Z',
    },
  })
  @ApiConflictResponse({
    description:
      '`BOOKING_NOT_DUE`: the prestation has not taken place. `BOOKING_CANCELLED`. ' +
      '`URSSAF_NOT_ACCEPTED`: the batch cooker does not take it. `URSSAF_LINK_NONE`, ' +
      '`URSSAF_LINK_PENDING`, `URSSAF_LINK_REFUSED`: no active enrolment. ' +
      '`URSSAF_REQUEST_PENDING`: already with URSSAF. Or already fully paid.',
  })
  @ApiNotFoundResponse({ description: 'No booking of the caller with this id.' })
  @ApiServiceUnavailableResponse({
    description:
      '`URSSAF_UNAVAILABLE`: the immediate advance is not open, or URSSAF is down.',
  })
  @ApiClerkAuthResponses()
  settle(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    // Validated for its `method`: only the immediate advance settles without a charge.
    @Body() _payload: SettleBookingDto,
  ) {
    return this.bookingPayments.settleWithUrssaf(user.userId, id);
  }

  @Get('me/urssaf-links')
  @ApiOperation({
    summary: 'List my immediate-advance enrolments',
    description:
      'The immediate advance exists per client **and** batch cooker: being enrolled ' +
      'with one does not open it for another. One row per batch cooker asked.',
  })
  @ApiOkResponse({ description: 'The enrolments.', example: [LINK_EXAMPLE] })
  @ApiClerkAuthResponses()
  myLinks(@CurrentClerkUser() user: ClerkUser) {
    return this.bookingPayments.myLinks(user.userId);
  }

  @Post('me/urssaf-links')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ask to be enrolled with a batch cooker',
    description:
      'Opens the enrolment, `pending` until URSSAF answers. Asking again while it is ' +
      'pending or active changes nothing; asking after a refusal reopens it.',
  })
  @ApiOkResponse({ description: 'The enrolment.', example: LINK_EXAMPLE })
  @ApiUnprocessableEntityResponse({
    description:
      '`URSSAF_NOT_ACCEPTED`: unknown batch cooker, or one that does not take the ' +
      'immediate advance. `SAME_PERSON`.',
  })
  @ApiServiceUnavailableResponse({
    description: '`URSSAF_UNAVAILABLE`: the immediate advance is not open yet.',
  })
  @ApiClerkAuthResponses()
  requestLink(
    @CurrentClerkUser() user: ClerkUser,
    @Body() payload: RequestUrssafLinkDto,
  ) {
    return this.bookingPayments.requestLink(user.userId, payload.chefProfileId);
  }
}

/**
 * The team watches the immediate advance and, while the gateway is simulated,
 * answers in URSSAF's place.
 */
@ApiTags(TAGS.payments)
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard, AdminGuard)
@Controller('admin')
export class AdminUrssafController {
  constructor(private readonly bookingPayments: BookingPaymentsService) {}

  @Get('urssaf-links')
  @ApiOperation({
    summary: 'List immediate-advance enrolments',
    description:
      'Every client and batch cooker pair, the ones waiting first. 200 at most.',
  })
  @ApiQuery({ name: 'status', required: false, enum: URSSAF_LINK_STATUSES })
  @ApiOkResponse({
    description: 'The enrolments, with the client.',
    example: [
      {
        ...LINK_EXAMPLE,
        client: {
          id: '3b1ebc99-9c0b-4ef8-bb6d-6bb9bd380a66',
          name: 'Sophie Marchand',
          email: 'sophie@exemple.fr',
        },
      },
    ],
  })
  @ApiAdminAuthResponses()
  links(@Query('status') status?: string) {
    return this.bookingPayments.adminLinks(
      (URSSAF_LINK_STATUSES as readonly string[]).includes(status ?? '')
        ? (status as UrssafLinkStatusKey)
        : undefined,
    );
  }

  @Post('urssaf-links/:id/decision')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Answer an enrolment in URSSAF’s place (simulation)',
    description:
      'Only while `URSSAF_GATEWAY=simulated`, never beside live Stripe keys. Sets the ' +
      'enrolment `active` or `refused`, as URSSAF will once the API access exists.',
  })
  @ApiParam({ name: 'id', description: 'The enrolment id.', example: LINK_ID })
  @ApiOkResponse({
    description: 'The enrolment.',
    example: { ...LINK_EXAMPLE, status: 'active', decidedAt: '2026-10-13T10:00:00.000Z' },
  })
  @ApiForbiddenResponse({
    description: 'Not an admin, or `URSSAF_NOT_SIMULATED`: the gateway is not simulated.',
  })
  @ApiNotFoundResponse({ description: 'No enrolment with this id.' })
  @ApiAdminAuthResponses()
  decideLink(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() payload: DecideUrssafLinkDto,
    @Req() req: { id?: unknown },
  ) {
    return this.bookingPayments.decideLink(
      user.userId,
      id,
      payload.status,
      payload.reason,
      requestId(req),
    );
  }

  @Get('urssaf-payments')
  @ApiOperation({
    summary: 'List immediate-advance payment requests',
    description: 'What was sent to URSSAF, newest first. 200 at most.',
  })
  @ApiOkResponse({
    description: 'The requests.',
    example: [
      {
        paymentId: PAYMENT_ID,
        status: 'pending',
        amountCents: 18000,
        debitedCents: 9000,
        urssafReference: 'SIM-6f1c2d3e',
        failureReason: null,
        createdAt: '2026-10-13T09:12:00.000Z',
        paidAt: null,
        booking: {
          id: BOOKING_ID,
          reference: 'LF-SM-2026-0001',
          clientName: 'Sophie Marchand',
          chefName: 'Alice Martin',
        },
      },
    ],
  })
  @ApiAdminAuthResponses()
  payments() {
    return this.bookingPayments.adminPayments();
  }

  @Post('urssaf-payments/:id/outcome')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Answer a payment request in URSSAF’s place (simulation)',
    description:
      'Only while `URSSAF_GATEWAY=simulated`. `paid` settles the prestation and makes ' +
      'the commission fall due; `refused` fails the request, and the client can pay ' +
      'another way.',
  })
  @ApiParam({ name: 'id', description: 'The payment id.', example: PAYMENT_ID })
  @ApiOkResponse({
    description: 'The request, settled.',
    example: { paymentId: PAYMENT_ID, status: 'succeeded' },
  })
  @ApiConflictResponse({
    description: '`URSSAF_REQUEST_SETTLED`: this request was already answered.',
  })
  @ApiForbiddenResponse({
    description: 'Not an admin, or `URSSAF_NOT_SIMULATED`: the gateway is not simulated.',
  })
  @ApiNotFoundResponse({ description: 'No immediate-advance request with this id.' })
  @ApiAdminAuthResponses()
  outcome(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() payload: SimulateUrssafOutcomeDto,
    @Req() req: { id?: unknown },
  ) {
    return this.bookingPayments.simulateOutcome(
      user.userId,
      id,
      payload.outcome,
      payload.reason,
      requestId(req),
    );
  }
}
