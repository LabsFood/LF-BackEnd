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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import {
  ApiAdminAuthResponses,
  ApiClerkAuthResponses,
} from '../../common/swagger/auth-responses';
import { TAGS } from '../../common/swagger/tags';
import {
  CreateServiceOfferDto,
  OfferPriceQueryDto,
  UpdateServiceOfferDto,
} from './dto/service-offer.dto';
import { ServiceOffersService } from './service-offers.service';

const OFFER_EXAMPLE = {
  id: '9c3ebc99-9c0b-4ef8-bb6d-6bb9bd380a99',
  name: 'Session 4 heures',
  description: null,
  durationMinutes: 240,
  priceCents: 18000,
  currency: 'EUR',
  shoppingIncluded: true,
  shoppingFeeCents: 1500,
  mealsIncluded: 3,
  active: true,
};

const NO_CHEF = 'No batch cooker page for this account (`NOT_A_CHEF`).';
const NOT_VERIFIED = 'The candidature is not approved yet (`CHEF_NOT_VERIFIED`).';
const OFFER_ID = {
  name: 'id',
  description: 'The service offer id.',
  example: OFFER_EXAMPLE.id,
};

@ApiTags(TAGS.chefBookings)
@ApiBearerAuth()
@Controller('me/chef/service-offers')
@UseGuards(ClerkAuthGuard)
export class ServiceOffersController {
  constructor(private readonly offers: ServiceOffersService) {}

  @Get()
  @ApiOperation({
    summary: 'My service offers',
    description:
      'What I sell: a length of visit and its price. Clients book one of the active ' +
      'ones, and the length sets the slot they are offered.',
  })
  @ApiOkResponse({ description: 'My offers, active first.', example: [OFFER_EXAMPLE] })
  @ApiNotFoundResponse({ description: NO_CHEF })
  @ApiForbiddenResponse({ description: NOT_VERIFIED })
  @ApiClerkAuthResponses()
  list(@CurrentClerkUser() user: ClerkUser) {
    return this.offers.list(user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Add a service offer' })
  @ApiCreatedResponse({ description: 'The offer.', example: OFFER_EXAMPLE })
  @ApiUnprocessableEntityResponse({
    description:
      '`SHOPPING_FEE_WITHOUT_SHOPPING`: a fee without `shoppingIncluded`. ' +
      '`OFFER_NAME_INVALID`: blank, or a reserved name.',
  })
  @ApiNotFoundResponse({ description: NO_CHEF })
  @ApiForbiddenResponse({ description: NOT_VERIFIED })
  @ApiClerkAuthResponses()
  create(@CurrentClerkUser() user: ClerkUser, @Body() body: CreateServiceOfferDto) {
    return this.offers.create(user.userId, body);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Change a service offer',
    description:
      'Only the fields sent change. Bookings already made keep their price and length. ' +
      'Turning `shoppingIncluded` off resets the fee to 0.',
  })
  @ApiParam(OFFER_ID)
  @ApiOkResponse({ description: 'The offer as saved.', example: OFFER_EXAMPLE })
  @ApiUnprocessableEntityResponse({
    description: '`SHOPPING_FEE_WITHOUT_SHOPPING` or `OFFER_NAME_INVALID`.',
  })
  @ApiNotFoundResponse({ description: `\`OFFER_NOT_FOUND\`, or ${NO_CHEF}` })
  @ApiForbiddenResponse({ description: NOT_VERIFIED })
  @ApiClerkAuthResponses()
  update(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateServiceOfferDto,
  ) {
    return this.offers.update(user.userId, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a service offer',
    description: 'Only an offer that was never booked. Otherwise turn it off.',
  })
  @ApiParam(OFFER_ID)
  @ApiNoContentResponse({ description: 'Deleted.' })
  @ApiConflictResponse({ description: '`OFFER_IN_USE`: it has bookings.' })
  @ApiNotFoundResponse({ description: `\`OFFER_NOT_FOUND\`, or ${NO_CHEF}` })
  @ApiForbiddenResponse({ description: NOT_VERIFIED })
  @ApiClerkAuthResponses()
  remove(@CurrentClerkUser() user: ClerkUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.offers.remove(user.userId, id);
  }
}

const PRICE_EXAMPLE = {
  serviceOfferId: OFFER_EXAMPLE.id,
  currency: 'EUR',
  priceCents: 18000,
  extraPersonsCents: 1500,
  extraMealsCents: 1600,
  shoppingFeeCents: 1500,
  amountTtc: 22600,
  amountAfterTax: 11300,
  rules: {
    includedPersons: 3,
    extraPersonCents: 1500,
    extraMealCents: 800,
  },
};

/** The back office reads every batch cooker's offers; it does not edit them. */
@ApiTags(TAGS.adminCatalog)
@ApiBearerAuth()
@Controller('admin/service-offers')
@UseGuards(ClerkAuthGuard, AdminGuard)
export class AdminServiceOffersController {
  constructor(private readonly offers: ServiceOffersService) {}

  @Get()
  @ApiOperation({
    summary: 'Admin: every batch cooker’s service offers',
    description:
      'The offers batch cookers sell (a length of visit and its price), grouped by cook ' +
      'then active first and by price, with how many bookings each carries. Not the ' +
      'platform formules of `GET /admin/formules`: those are the same for everyone.',
  })
  @ApiOkResponse({
    description: 'Every offer, with its batch cooker.',
    example: [
      {
        ...OFFER_EXAMPLE,
        chef: {
          id: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
          displayName: 'Chef Marie D.',
        },
        bookingsCount: 3,
      },
    ],
  })
  @ApiAdminAuthResponses()
  list() {
    return this.offers.listAll();
  }
}

/** What a client sees before booking: public, no token. */
@ApiTags(TAGS.catalog)
@Controller('service-offers')
export class PublicServiceOffersController {
  constructor(private readonly offers: ServiceOffersService) {}

  @Get(':id/price')
  @ApiOperation({
    summary: 'Price a booking of a service offer',
    description:
      'The amounts `POST /me/bookings` will set, line by line: the offer’s price, ' +
      'adults beyond `rules.includedPersons`, the `extraMeals` asked for, and ' +
      'the shopping fee unless `shoppingByClient`. `amountTtc` is what the client pays, ' +
      '`amountAfterTax` what they bear after the 50 % tax credit. Show these: never ' +
      'add supplements on the page. Public.\n\n' +
      'Example: `?persons=4&extraMeals=2&shoppingByClient=false`.',
  })
  @ApiParam(OFFER_ID)
  @ApiOkResponse({ description: 'The price, line by line.', example: PRICE_EXAMPLE })
  @ApiNotFoundResponse({
    description: '`OFFER_NOT_FOUND`: no active offer of a listed batch cooker.',
  })
  price(@Param('id', ParseUUIDPipe) id: string, @Query() query: OfferPriceQueryDto) {
    return this.offers.price(id, query);
  }
}
