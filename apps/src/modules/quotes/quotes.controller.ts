import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
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

import {
  ApiAdminAuthResponses,
  ApiClerkAuthResponses,
} from '../../common/swagger/auth-responses';
import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { ApiGeoResponses } from '../../common/swagger/geo-responses';
import { TAGS } from '../../common/swagger/tags';
import {
  ADMIN_QUOTE_FILTERS,
  CreateQuoteDto,
  CreateQuoteOfferDto,
  DeclineDto,
  QUOTE_STATUS_HELP,
  QUOTE_STATUSES,
  UpdateQuoteAdminDto,
} from './dto/quote.dto';
import { QuoteOffersService } from './quote-offers.service';
import { QuotesService } from './quotes.service';

const QUOTE_ID = '5d1ebc99-9c0b-4ef8-bb6d-6bb9bd380abb';
const OFFER_ID = '8b3ebc99-9c0b-4ef8-bb6d-6bb9bd380add';

const CHEF = {
  userId: 'f5eebc99-9c0b-4ef8-bb6d-6bb9bd380a66',
  chefProfileId: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
  displayName: 'Marie Dupont',
  city: 'Nice',
  avatarUrl: null,
};

const OFFER = {
  id: OFFER_ID,
  status: 'sent',
  clientPriceCents: 20000,
  afterTaxCreditCents: 10000,
  netCents: 17000,
  commissionBps: 1500,
  proposedDate: null,
  proposedTimeSlot: null,
  conditions: 'Courses incluses. Déplacement compris dans un rayon de 30 km.',
  validUntil: '2026-10-19T09:12:00.000Z',
  viewedAt: null,
  decidedAt: null,
  declineReason: null,
  createdAt: '2026-10-12T09:12:00.000Z',
};

const QUOTE = {
  id: QUOTE_ID,
  reference: 'DEM-2026-0007',
  status: 'submitted',
  title: 'Dîner d’anniversaire pour 12',
  occasion: 'Anniversaire',
  persons: 12,
  mealsCount: 3,
  cuisine: 'Méditerranéenne',
  diet: ['végétarien'],
  allergies: ['gluten'],
  brief: 'Dîner dans le jardin, service simple, dessert indispensable.',
  desiredDate: '2026-11-14',
  timeSlot: 'evening',
  address: { line: '12 rue des Lilas', city: 'Nice', postalCode: '06000' },
  budgetCents: 40000,
  chef: CHEF,
  chefDeclinedAt: null,
  offers: [],
  activeOffer: null,
  booking: null,
  createdAt: '2026-10-11T18:40:00.000Z',
  updatedAt: '2026-10-11T18:40:00.000Z',
  clientId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  assignedChefUserId: CHEF.userId,
  assignedChef: {
    userId: CHEF.userId,
    chefProfileId: CHEF.chefProfileId,
    displayName: CHEF.displayName,
  },
};

const QUOTED = { ...QUOTE, status: 'quoted', offers: [OFFER], activeOffer: OFFER };

const ACCEPTED = {
  ...QUOTE,
  status: 'accepted',
  offers: [{ ...OFFER, status: 'accepted', decidedAt: '2026-10-13T08:00:00.000Z' }],
  booking: {
    id: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
    reference: 'LF-SM-2026-0007',
    startsAt: '2026-11-14T17:00:00.000Z',
    endsAt: '2026-11-14T21:00:00.000Z',
  },
};

const error = (code: string, message: string) => ({ code, message });

const reqId = (req: { id?: unknown }): string | undefined =>
  typeof req.id === 'string' ? req.id : undefined;

const ApiQuoteIdParam = () =>
  ApiParam({ name: 'id', description: 'The request id.', example: QUOTE_ID });
const ApiOfferIdParam = () =>
  ApiParam({ name: 'offerId', description: 'The offer id.', example: OFFER_ID });

const NOT_YOURS = 'No such request, or not the caller’s.';

const FLOW =
  'A custom request goes like this: the client sends it, to a batch cooker they ' +
  'chose or to the team; the batch cooker answers with an offer or turns it down; ' +
  'the client accepts or refuses the offer. Accepting creates the prestation.';

/** The client side of a custom request. */
@ApiTags(TAGS.quotes)
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller()
export class QuotesController {
  constructor(
    private readonly quotes: QuotesService,
    private readonly offers: QuoteOffersService,
  ) {}

  @Post('quotes')
  @ApiOperation({
    summary: 'Send a custom request',
    description:
      `${FLOW}\n\n` +
      'With `chefProfileId` the request goes to that batch cooker, who is emailed. ' +
      'Without it, the team is told and gives it to one. It starts as `submitted` ' +
      'with a reference like `DEM-2026-0007`.',
  })
  @ApiCreatedResponse({ description: 'The new request.', example: QUOTE })
  @ApiUnprocessableEntityResponse({
    description:
      '`DATE_TOO_SOON`: the day must be tomorrow at the earliest. ' +
      '`CHEF_NOT_AVAILABLE`: not a verified batch cooker.',
    example: error('CHEF_NOT_AVAILABLE', 'chefProfileId is not a verified batch cooker.'),
  })
  @ApiGeoResponses()
  @ApiClerkAuthResponses()
  createQuote(@CurrentClerkUser() user: ClerkUser, @Body() payload: CreateQuoteDto) {
    return this.quotes.createQuote(user.userId, payload);
  }

  @Get('me/quotes')
  @ApiOperation({
    summary: 'List my custom requests',
    description:
      `The signed-in client's requests, newest first. ${QUOTE_STATUS_HELP}\n\n` +
      '`activeOffer` is the offer waiting for an answer, `offers` the whole history. ' +
      'The client reads what they pay (`clientPriceCents`) and what is left after ' +
      'the tax credit (`afterTaxCreditCents`), never what the batch cooker earns.',
  })
  @ApiOkResponse({ description: 'The requests.', example: [QUOTED] })
  @ApiClerkAuthResponses()
  listMyQuotes(@CurrentClerkUser() user: ClerkUser) {
    return this.quotes.listMine(user.userId);
  }

  @Get('me/quotes/:id')
  @ApiQuoteIdParam()
  @ApiOperation({
    summary: 'Read one of my requests',
    description:
      'Reading a request marks its offer as seen: `sent` becomes `viewed`, which the ' +
      'batch cooker follows on their side.',
  })
  @ApiOkResponse({ description: 'The request.', example: QUOTED })
  @ApiNotFoundResponse({ description: NOT_YOURS })
  @ApiClerkAuthResponses()
  getMyQuote(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.quotes.getMine(user.userId, id);
  }

  @Delete('me/quotes/:id')
  @ApiQuoteIdParam()
  @ApiOperation({
    summary: 'Withdraw one of my requests',
    description:
      'The request becomes `cancelled` and an offer still open is withdrawn. It is ' +
      'kept, not erased: the batch cooker and the team still see what happened. An ' +
      'accepted request cannot be withdrawn: it is a prestation now.',
  })
  @ApiOkResponse({
    description: 'The request, cancelled.',
    example: { ...QUOTE, status: 'cancelled' },
  })
  @ApiNotFoundResponse({ description: NOT_YOURS })
  @ApiConflictResponse({
    description: '`QUOTE_ALREADY_ACCEPTED`.',
    example: error(
      'QUOTE_ALREADY_ACCEPTED',
      'An accepted request has become a prestation: cancel the prestation instead.',
    ),
  })
  @ApiClerkAuthResponses()
  cancelMyQuote(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.quotes.cancelMine(user.userId, id);
  }

  @Post('me/quotes/:id/offers/:offerId/accept')
  @HttpCode(HttpStatus.OK)
  @ApiQuoteIdParam()
  @ApiOfferIdParam()
  @ApiOperation({
    summary: 'Accept an offer',
    description:
      'The agreement on the price. In one go: the offer is `accepted`, the request ' +
      'too, and the prestation is created (`booking`), confirmed, on the day and slot ' +
      'of the offer (the ones asked, unless the batch cooker proposed others). It ' +
      'shows in `GET /bookings/me` for both. The conversation between the two opens ' +
      'and both receive a confirmation email with the recap.\n\n' +
      'Nothing is paid here: payment comes after the prestation.',
  })
  @ApiOkResponse({ description: 'The request, with its prestation.', example: ACCEPTED })
  @ApiNotFoundResponse({ description: `${NOT_YOURS} Or no such offer.` })
  @ApiConflictResponse({
    description:
      '`OFFER_EXPIRED`: past `validUntil`. `OFFER_NOT_ACTIVE`: already answered, ' +
      'withdrawn or expired.',
    example: error(
      'OFFER_EXPIRED',
      'This offer has expired. The batch cooker can send a new one.',
    ),
  })
  @ApiClerkAuthResponses()
  acceptOffer(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('offerId', ParseUUIDPipe) offerId: string,
  ) {
    return this.offers.accept(user.userId, id, offerId);
  }

  @Post('me/quotes/:id/offers/:offerId/decline')
  @HttpCode(HttpStatus.OK)
  @ApiQuoteIdParam()
  @ApiOfferIdParam()
  @ApiOperation({
    summary: 'Refuse an offer',
    description:
      'The offer is `declined` and so is the request, which stays open: the batch ' +
      'cooker is emailed with the reason and may send another offer.',
  })
  @ApiOkResponse({
    description: 'The request.',
    example: {
      ...QUOTE,
      status: 'declined',
      offers: [
        { ...OFFER, status: 'declined', declineReason: 'Au-dessus de mon budget.' },
      ],
    },
  })
  @ApiNotFoundResponse({ description: `${NOT_YOURS} Or no such offer.` })
  @ApiConflictResponse({ description: '`OFFER_NOT_ACTIVE`.' })
  @ApiClerkAuthResponses()
  declineOffer(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Body() body: DeclineDto,
  ) {
    return this.offers.decline(user.userId, id, offerId, body.reason);
  }

  @Post('me/quotes/:id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiQuoteIdParam()
  @ApiOperation({
    summary: 'Accept the offer of a request',
    deprecated: true,
    description:
      'Kept for the apps written before offers had an id: accepts the offer waiting ' +
      'for an answer. Use `POST /me/quotes/{id}/offers/{offerId}/accept`, which ' +
      'cannot accept an offer the client has not read.',
  })
  @ApiOkResponse({ description: 'The request, with its prestation.', example: ACCEPTED })
  @ApiNotFoundResponse({ description: `${NOT_YOURS} Or no offer is waiting.` })
  @ApiClerkAuthResponses()
  acceptQuote(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.offers.accept(user.userId, id);
  }
}

/** What a batch cooker does with the requests they are given. */
@ApiTags(TAGS.quotes)
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
// Every route here is work: a candidate awaiting approval gets this 403.
@ApiForbiddenResponse({
  description: '`CHEF_NOT_VERIFIED`: the candidature is not approved yet.',
})
@Controller('me/chef/quotes')
export class ChefQuotesController {
  constructor(
    private readonly quotes: QuotesService,
    private readonly offers: QuoteOffersService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List the requests I am given',
    description:
      'For a verified batch cooker: the requests that are with them now, and the ' +
      'ones they made an offer on, most recently touched first.\n\n' +
      'Until an offer is accepted, the batch cooker sees the town and the postcode ' +
      'but not the street, and the client as "Sophie M." with no contact details. ' +
      `Both come with the accepted offer.\n\n${QUOTE_STATUS_HELP}`,
  })
  @ApiOkResponse({
    description: 'The requests.',
    example: [
      {
        ...QUOTE,
        address: { line: null, city: 'Nice', postalCode: '06000' },
        client: { id: QUOTE.clientId, name: 'Sophie M.', email: null, phone: null },
      },
    ],
  })
  @ApiForbiddenResponse({
    description: '`CHEF_NOT_VERIFIED`: the candidature is not approved yet.',
  })
  @ApiNotFoundResponse({ description: '`NOT_A_CHEF`: no batch cooker page.' })
  @ApiClerkAuthResponses()
  list(@CurrentClerkUser() user: ClerkUser) {
    return this.quotes.listForChef(user.userId);
  }

  @Get(':id')
  @ApiQuoteIdParam()
  @ApiOperation({ summary: 'Read one request I am given' })
  @ApiOkResponse({ description: 'The request.', example: QUOTE })
  @ApiNotFoundResponse({ description: 'No such request, or it is not with the caller.' })
  @ApiClerkAuthResponses()
  get(@CurrentClerkUser() user: ClerkUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.getForChef(user.userId, id);
  }

  @Post(':id/offers')
  @ApiQuoteIdParam()
  @ApiOperation({
    summary: 'Send an offer',
    description:
      'The batch cooker says what they want to earn (`netCents`). The API adds the ' +
      'platform commission of the day to get the client price, and what is left to ' +
      'the client after the 50 % tax credit. The three amounts are stored on the ' +
      'offer and never recomputed. `GET /pricing-rules` gives the rates for a ' +
      'preview while typing.\n\n' +
      'The request becomes `quoted` and the client is emailed. One offer at a time: ' +
      'withdraw the open one before sending another. After `validityDays` (7 by ' +
      'default) with no answer, the offer expires and the request comes back.',
  })
  @ApiCreatedResponse({ description: 'The request, with the offer.', example: QUOTED })
  @ApiNotFoundResponse({ description: 'No such request, or it is not with the caller.' })
  @ApiConflictResponse({
    description:
      '`OFFER_ALREADY_ACTIVE`: one is waiting for the client. `QUOTE_CLOSED`: the ' +
      'request is accepted, cancelled or was turned down.',
    example: error(
      'OFFER_ALREADY_ACTIVE',
      'An offer is already waiting for the client. Withdraw it first.',
    ),
  })
  @ApiUnprocessableEntityResponse({ description: '`DATE_TOO_SOON`.' })
  @ApiClerkAuthResponses()
  createOffer(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateQuoteOfferDto,
  ) {
    return this.offers.createAsChef(user.userId, id, body);
  }

  @Post(':id/offers/:offerId/withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiQuoteIdParam()
  @ApiOfferIdParam()
  @ApiOperation({
    summary: 'Withdraw my offer',
    description:
      'Before the client has answered. The offer is `withdrawn` and the request is ' +
      'back to `submitted`: another offer can be sent.',
  })
  @ApiOkResponse({ description: 'The request.', example: QUOTE })
  @ApiNotFoundResponse({ description: 'No open offer of the caller with this id.' })
  @ApiClerkAuthResponses()
  withdrawOffer(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('offerId', ParseUUIDPipe) offerId: string,
  ) {
    return this.offers.withdrawAsChef(user.userId, id, offerId);
  }

  @Post(':id/decline')
  @HttpCode(HttpStatus.OK)
  @ApiQuoteIdParam()
  @ApiOperation({
    summary: 'Turn a request down',
    description:
      'The request becomes `chef_declined` and leaves the batch cooker. The team is ' +
      'emailed with the reason and gives it to someone else; the client can wait or ' +
      'withdraw. Not possible while an offer is open: withdraw it first.',
  })
  @ApiOkResponse({
    description: 'The request, as the batch cooker left it.',
    example: {
      ...QUOTE,
      status: 'chef_declined',
      chef: null,
      assignedChef: null,
      assignedChefUserId: null,
    },
  })
  @ApiNotFoundResponse({ description: 'No such request, or it is not with the caller.' })
  @ApiConflictResponse({ description: '`OFFER_ALREADY_ACTIVE` or `QUOTE_CLOSED`.' })
  @ApiClerkAuthResponses()
  decline(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DeclineDto,
  ) {
    return this.quotes.declineAsChef(user.userId, id, body.reason);
  }
}

/** The team: sees every request, gives it to a batch cooker, steps in. */
@ApiTags(TAGS.adminQuotes)
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard, AdminGuard)
@Controller('admin/quotes')
export class AdminQuotesController {
  constructor(
    private readonly quotes: QuotesService,
    private readonly offers: QuoteOffersService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List custom requests',
    description:
      'Every request with its client, its batch cooker and its offers, newest ' +
      'first, not paginated. `filter=needs_chef` keeps the ones nobody can answer: ' +
      'the client chose no batch cooker, or theirs turned it down ' +
      `(\`chefDeclineReason\` says why).\n\n${QUOTE_STATUS_HELP}`,
  })
  @ApiQuery({ name: 'status', required: false, enum: QUOTE_STATUSES })
  @ApiQuery({ name: 'filter', required: false, enum: ADMIN_QUOTE_FILTERS })
  @ApiOkResponse({
    description: 'The requests.',
    example: [
      {
        ...QUOTE,
        chefDeclineReason: null,
        client: {
          id: QUOTE.clientId,
          name: 'Sophie Marchand',
          email: 'sophie.marchand@exemple.fr',
          phone: '+33612345678',
        },
      },
    ],
  })
  @ApiAdminAuthResponses()
  list(@Query('status') status?: string, @Query('filter') filter?: string) {
    return this.quotes.listAdmin(
      QUOTE_STATUSES.includes(status as (typeof QUOTE_STATUSES)[number])
        ? status
        : undefined,
      filter,
    );
  }

  @Get(':id')
  @ApiQuoteIdParam()
  @ApiOperation({ summary: 'Read one custom request' })
  @ApiOkResponse({ description: 'The request.', example: QUOTED })
  @ApiNotFoundResponse({ description: 'No such request.' })
  @ApiAdminAuthResponses()
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.getAdmin(id);
  }

  @Patch(':id')
  @ApiQuoteIdParam()
  @ApiOperation({
    summary: 'Give a request to a batch cooker, or correct it',
    description:
      'Send only what changes.\n\n' +
      '- `assignedChefUserId`: gives the request to a verified batch cooker, who is ' +
      'emailed. The request is back to `submitted` and an offer the previous one ' +
      'left open is withdrawn. `null` takes it back.\n' +
      '- `status`: `in_review` or `submitted`, or `closed` to close it without ' +
      'follow-up: Lab’s Food’s decision, distinct from the client’s `declined` and ' +
      '`cancelled`. An offer still waiting is withdrawn; a closed request stays closed. ' +
      'The rest follows what the batch cooker and the client do.\n' +
      '- `title`, `persons`, `mealsCount`, `cuisine`, `diet`, `brief`: corrections.\n\n' +
      'To price a request, use `POST /admin/quotes/{id}/offers`.',
  })
  @ApiOkResponse({ description: 'The request.', example: QUOTE })
  @ApiNotFoundResponse({ description: 'No such request.' })
  @ApiConflictResponse({
    description:
      '`QUOTE_CLOSED`: accepted, cancelled or closed. `OFFER_PENDING`: the status ' +
      'cannot be set while an offer waits for the client (closing can).',
  })
  @ApiUnprocessableEntityResponse({
    description:
      '`CHEF_NOT_ASSIGNABLE`: not a verified batch cooker. `CLOSE_OR_ASSIGN`: ' +
      '`closed` and a new `assignedChefUserId` sent together.',
  })
  @ApiAdminAuthResponses()
  update(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() payload: UpdateQuoteAdminDto,
    @Req() req: { id?: unknown },
  ) {
    return this.quotes.updateAdmin(user.userId, id, payload, reqId(req));
  }

  @Post(':id/offers')
  @ApiQuoteIdParam()
  @ApiOperation({
    summary: 'Price a request in the name of its batch cooker',
    description:
      'For the day the batch cooker cannot do it themselves. The same offer as ' +
      '`POST /me/chef/quotes/{id}/offers`, made in the name of the batch cooker the ' +
      'request is with, and recorded in the audit log as the admin’s.',
  })
  @ApiCreatedResponse({ description: 'The request, with the offer.', example: QUOTED })
  @ApiNotFoundResponse({ description: 'No such request.' })
  @ApiConflictResponse({
    description:
      '`QUOTE_HAS_NO_CHEF`: assign one first. `OFFER_ALREADY_ACTIVE`, `QUOTE_CLOSED`.',
  })
  @ApiAdminAuthResponses()
  createOffer(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateQuoteOfferDto,
    @Req() req: { id?: unknown },
  ) {
    return this.offers.createAsAdmin(user.userId, id, body, reqId(req));
  }
}
