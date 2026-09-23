import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import {
  ApiAdminAuthResponses,
  ApiClerkAuthResponses,
} from '../../common/swagger/auth-responses';
import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { TAGS } from '../../common/swagger/tags';
import {
  CreateQuoteDto,
  QUOTE_STATUS_HELP,
  QUOTE_STATUSES,
  UpdateQuoteAdminDto,
} from './dto/quote.dto';
import { QuotesService } from './quotes.service';

const QUOTE = {
  id: '5d1ebc99-9c0b-4ef8-bb6d-6bb9bd380abb',
  reference: 'DEM-2026-0007',
  clientId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  title: 'Dîner d’anniversaire pour 12',
  persons: 12,
  mealsCount: 3,
  cuisine: 'Méditerranéenne',
  diet: ['végétarien'],
  brief: 'Dîner dans le jardin, service simple, dessert indispensable.',
  status: 'submitted',
  assignedChefUserId: null,
  quoteAmountTtc: null,
  quoteAmountAfterTax: null,
  quoteNote: null,
  createdAt: '2026-09-22T18:40:00.000Z',
  updatedAt: '2026-09-22T18:40:00.000Z',
};

const QUOTED = {
  ...QUOTE,
  status: 'quoted',
  quoteAmountTtc: 45000,
  quoteAmountAfterTax: 22500,
  quoteNote: 'Service et rangement compris.',
};

const ApiQuoteIdParam = () =>
  ApiParam({
    name: 'id',
    description: 'The quote id.',
    example: QUOTE.id,
  });

@Controller()
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Post('quotes')
  @ApiTags(TAGS.quotes)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard)
  @ApiOperation({
    summary: 'Ask for a quote',
    description:
      'For an event or a larger order: how many people, how many dishes, the cuisine, ' +
      'the diets, and a free description. The quote starts as `submitted` with a ' +
      'reference like `DEM-2026-0007`. An admin then sends a price, which the client ' +
      'follows with `GET /me/quotes`.',
  })
  @ApiCreatedResponse({ description: 'The new quote request.', example: QUOTE })
  @ApiClerkAuthResponses()
  createQuote(@CurrentClerkUser() user: ClerkUser, @Body() payload: CreateQuoteDto) {
    return this.quotes.createQuote(user.userId, payload);
  }

  @Get('me/quotes')
  @ApiTags(TAGS.quotes)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard)
  @ApiOperation({
    summary: 'List my quotes',
    description:
      `The signed-in client's quote requests, newest first. ${QUOTE_STATUS_HELP} ` +
      'Once `quoted`, `quoteAmountTtc`, `quoteAmountAfterTax` and `quoteNote` hold the ' +
      'offer.',
  })
  @ApiOkResponse({ description: 'The quotes.', example: [QUOTED] })
  @ApiClerkAuthResponses()
  listMyQuotes(@CurrentClerkUser() user: ClerkUser) {
    return this.quotes.listMyQuotes(user.userId);
  }

  @Post('me/quotes/:id/accept')
  @ApiTags(TAGS.quotes)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard)
  @ApiOperation({
    summary: 'Accept a quote',
    description:
      'The client accepts the offer: the quote becomes `accepted`. Only the client ' +
      'who asked for it can accept it.\n\n' +
      'The app should only offer this once the quote is `quoted`: the API does not ' +
      'check the status today.',
  })
  @ApiQuoteIdParam()
  @ApiCreatedResponse({
    description: 'The accepted quote.',
    example: { ...QUOTED, status: 'accepted' },
  })
  @ApiNotFoundResponse({ description: 'No such quote, or not yours.' })
  @ApiClerkAuthResponses()
  acceptQuote(@CurrentClerkUser() user: ClerkUser, @Param('id') id: string) {
    return this.quotes.acceptMyQuote(user.userId, id);
  }

  @Get('admin/quotes')
  @ApiTags(TAGS.adminQuotes)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'List quote requests',
    description:
      'Every quote request with its client, newest first, not paginated. ' +
      '`?status=submitted` shows the new ones.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: QUOTE_STATUSES,
    description: `Keep one status only. ${QUOTE_STATUS_HELP}`,
  })
  @ApiOkResponse({
    description: 'The quotes.',
    example: [
      {
        ...QUOTE,
        client: {
          id: QUOTE.clientId,
          email: 'client@example.com',
          fullName: 'Lucas Martin',
          role: 'client',
        },
      },
    ],
  })
  @ApiAdminAuthResponses()
  listAdminQuotes(@Query('status') status?: string) {
    return this.quotes.listAdminQuotes(status);
  }

  @Patch('admin/quotes/:id')
  @ApiTags(TAGS.adminQuotes)
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Send a price, or update a quote',
    description:
      'Send only the fields to change. To send an offer to the client:\n\n' +
      '`{ "status": "quoted", "quoteAmountTtc": 45000, "quoteAmountAfterTax": 22500, ' +
      '"quoteNote": "Service et rangement compris." }`\n\n' +
      'The client sees it in `GET /me/quotes` and can accept it.',
  })
  @ApiQuoteIdParam()
  @ApiOkResponse({ description: 'The updated quote.', example: QUOTED })
  @ApiAdminAuthResponses()
  patchAdminQuote(@Param('id') id: string, @Body() payload: UpdateQuoteAdminDto) {
    return this.quotes.updateAdminQuote(id, payload);
  }
}
