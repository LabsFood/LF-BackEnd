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

import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { ApiClerkAuthResponses } from '../../common/swagger/auth-responses';
import { TAGS } from '../../common/swagger/tags';
import { CreateServiceOfferDto, UpdateServiceOfferDto } from './dto/service-offer.dto';
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
