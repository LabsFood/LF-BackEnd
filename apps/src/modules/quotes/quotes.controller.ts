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
import { CreateQuoteDto, UpdateQuoteAdminDto } from './dto/quote.dto';
import { QuotesService } from './quotes.service';

@ApiTags('quotes')
@Controller()
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Post('quotes')
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard)
  @ApiOperation({
    summary: 'Submit a custom catering quote request',
    description:
      'Authenticated clients request a bespoke quote (event size, cuisine, dietary needs). ' +
      'Creates a quote in `pending` status for admin review.',
  })
  @ApiOkResponse({ description: 'Created quote record.' })
  @ApiClerkAuthResponses()
  createQuote(@CurrentClerkUser() user: ClerkUser, @Body() payload: CreateQuoteDto) {
    return this.quotes.createQuote(user.userId, payload);
  }

  @Get('me/quotes')
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard)
  @ApiOperation({
    summary: 'List my quote requests',
    description:
      'Returns all quotes submitted by the authenticated client, newest first. Each quote ' +
      "carries `chefCesu` — the assigned chef's prefinanced-CESU coordinates, including the " +
      'CRCESU number (NAN) a client needs to add them as an intervenant on their issuer ' +
      'portal. `null` until a chef is assigned.',
  })
  @ApiOkResponse({
    description:
      'Array of quote records owned by the caller, each with a `chefCesu` block.',
  })
  @ApiClerkAuthResponses()
  listMyQuotes(@CurrentClerkUser() user: ClerkUser) {
    return this.quotes.listMyQuotes(user.userId);
  }

  @Post('me/quotes/:id/accept')
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard)
  @ApiOperation({
    summary: 'Accept a quoted price',
    description:
      'Client accepts an admin-provided quote amount. ' +
      '`:id` is the quote uuid. Quote must be in a quotable status.',
  })
  @ApiParam({ name: 'id', description: 'Quote uuid.', format: 'uuid' })
  @ApiOkResponse({ description: 'Quote after acceptance.' })
  @ApiClerkAuthResponses()
  acceptQuote(@CurrentClerkUser() user: ClerkUser, @Param('id') id: string) {
    return this.quotes.acceptMyQuote(user.userId, id);
  }

  @Get('admin/quotes')
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Admin: list quote requests',
    description:
      'Returns all client quote requests, optionally filtered by workflow status.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Filter by quote status (e.g. `pending`, `quoted`, `accepted`).',
  })
  @ApiOkResponse({ description: 'Array of quote records with client info.' })
  @ApiAdminAuthResponses()
  listAdminQuotes(@Query('status') status?: string) {
    return this.quotes.listAdminQuotes(status);
  }

  @Patch('admin/quotes/:id')
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Admin: update a quote',
    description:
      'Patches quote details, status, and quoted amounts. ' +
      'Use to send a price back to the client for acceptance.',
  })
  @ApiParam({ name: 'id', description: 'Quote uuid.', format: 'uuid' })
  @ApiOkResponse({ description: 'Updated quote record.' })
  @ApiAdminAuthResponses()
  patchAdminQuote(@Param('id') id: string, @Body() payload: UpdateQuoteAdminDto) {
    return this.quotes.updateAdminQuote(id, payload);
  }
}
