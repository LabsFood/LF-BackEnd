import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

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
  createQuote(@CurrentClerkUser() user: ClerkUser, @Body() payload: CreateQuoteDto) {
    return this.quotes.createQuote(user.userId, payload);
  }

  @Get('me/quotes')
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard)
  listMyQuotes(@CurrentClerkUser() user: ClerkUser) {
    return this.quotes.listMyQuotes(user.userId);
  }

  @Post('me/quotes/:id/accept')
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard)
  acceptQuote(@CurrentClerkUser() user: ClerkUser, @Param('id') id: string) {
    return this.quotes.acceptMyQuote(user.userId, id);
  }

  @Get('admin/quotes')
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  listAdminQuotes(@Query('status') status?: string) {
    return this.quotes.listAdminQuotes(status);
  }

  @Patch('admin/quotes/:id')
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard, AdminGuard)
  patchAdminQuote(@Param('id') id: string, @Body() payload: UpdateQuoteAdminDto) {
    return this.quotes.updateAdminQuote(id, payload);
  }
}
