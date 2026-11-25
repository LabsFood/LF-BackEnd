import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { ApiClerkAuthResponses } from '../../common/swagger/auth-responses';
import { TAGS } from '../../common/swagger/tags';
import { AgendaService, MAX_BLOCKS_AHEAD } from './agenda.service';
import {
  AgendaQueryDto,
  AgendaSummaryQueryDto,
  TimeBlockDto,
} from './dto/availability.dto';

const NO_CHEF = 'No batch cooker page for this account (`NOT_A_CHEF`).';
const NOT_VERIFIED = 'The candidature is not approved yet (`CHEF_NOT_VERIFIED`).';

const BLOCK_EXAMPLE = {
  id: '6f1c2a3b-0d4e-4f5a-9b8c-7d6e5f4a3b2c',
  startsAt: '2026-10-22T12:00:00.000Z',
  endsAt: '2026-10-22T14:00:00.000Z',
  reason: 'Dentiste',
};

const AGENDA_EXAMPLE = {
  scheduled: true,
  schedule: {
    weekly: [
      { id: '0b6f…', weekday: 0, startMinute: 540, endMinute: 780 },
      { id: '1c7a…', weekday: 2, startMinute: 840, endMinute: 1140 },
    ],
    exceptions: [
      {
        id: '2d8b…',
        date: '2026-10-23',
        kind: 'closed',
        startMinute: null,
        endMinute: null,
        reason: 'Vacances',
      },
    ],
    version: 'k3Vq0Zb1xT2mN8aR',
  },
  prestations: [
    {
      id: '3e9c…',
      reference: 'LF-2026-0042',
      status: 'confirmed',
      startsAt: '2026-10-19T07:00:00.000Z',
      endsAt: '2026-10-19T10:00:00.000Z',
      timeSlot: '09:00-12:00',
      persons: 4,
      city: 'Paris',
      client: { name: 'Sophie M.' },
      rescheduleTo: null,
    },
  ],
  requests: [
    {
      id: '4fa0…',
      reference: 'DEM-2026-0007',
      title: 'Anniversaire de Léa',
      stage: 'offer_sent',
      persons: 8,
      city: 'Lyon',
      client: { name: 'Karim B.' },
      startsAt: '2026-10-24T12:00:00.000Z',
      endsAt: '2026-10-24T16:00:00.000Z',
    },
  ],
  blocks: [BLOCK_EXAMPLE],
};

@ApiTags(TAGS.chefBookings)
@ApiBearerAuth()
@Controller('chef/agenda')
@UseGuards(ClerkAuthGuard)
export class ChefAgendaController {
  constructor(private readonly agenda: AgendaService) {}

  @Get()
  @ApiOperation({
    summary: 'My agenda',
    description:
      'One read for the day, week and month views, past included: the schedule (as ' +
      '`GET /chef/availability`, with only the exceptions of the window), the ' +
      'prestations (cancelled ones left out), the custom requests assigned to me and ' +
      'my blocks. A request sits at the time its open offer proposes, else the time ' +
      'asked; `stage` is `to_answer` or `offer_sent`; `startsAt` is null when the ' +
      'client gave no date. Clients appear by first name and initial. ' +
      '`rescheduleTo`: the new start proposed for a prestation, while it waits for ' +
      'an answer.',
  })
  @ApiOkResponse({ description: 'The agenda.', example: AGENDA_EXAMPLE })
  @ApiUnprocessableEntityResponse({
    description: '`VALIDATION_FAILED`: the window is empty or over 42 days.',
  })
  @ApiNotFoundResponse({ description: NO_CHEF })
  @ApiForbiddenResponse({ description: NOT_VERIFIED })
  @ApiClerkAuthResponses()
  read(@CurrentClerkUser() user: ClerkUser, @Query() query: AgendaQueryDto) {
    return this.agenda.read(user.userId, query);
  }

  @Get('summary')
  @ApiOperation({
    summary: 'My year, month by month',
    description:
      'Prestations per month of their start, Paris time, cancelled ones left out. ' +
      'For the year view.',
  })
  @ApiOkResponse({
    description: 'Twelve months, January first.',
    example: { year: 2026, months: [{ month: 1, prestations: 3 }] },
  })
  @ApiNotFoundResponse({ description: NO_CHEF })
  @ApiForbiddenResponse({ description: NOT_VERIFIED })
  @ApiClerkAuthResponses()
  summary(@CurrentClerkUser() user: ClerkUser, @Query() query: AgendaSummaryQueryDto) {
    return this.agenda.summary(user.userId, query.year);
  }

  @Post('blocks')
  @ApiOperation({
    summary: 'Block some of my time',
    description:
      'A dentist, an afternoon off: no client can book it. The same block sent twice ' +
      'returns the first. Whole days off belong in `PUT /chef/availability` as ' +
      '`closed` exceptions.',
  })
  @ApiCreatedResponse({ description: 'The block.', example: BLOCK_EXAMPLE })
  @ApiUnprocessableEntityResponse({
    description:
      '`RANGE_INVALID`: it ends before it starts. `VALIDATION_FAILED`: it is over, or ' +
      'longer than 42 days.',
  })
  @ApiConflictResponse({
    description:
      '`BLOCK_OVERLAPS_BOOKING`: a prestation holds this time. `TOO_MANY_BLOCKS`: ' +
      `${MAX_BLOCKS_AHEAD} blocks ahead already.`,
  })
  @ApiNotFoundResponse({ description: NO_CHEF })
  @ApiForbiddenResponse({ description: NOT_VERIFIED })
  @ApiClerkAuthResponses()
  addBlock(@CurrentClerkUser() user: ClerkUser, @Body() body: TimeBlockDto) {
    return this.agenda.addBlock(user.userId, body);
  }

  @Delete('blocks/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Free a block' })
  @ApiNoContentResponse({ description: 'Removed.' })
  @ApiNotFoundResponse({
    description:
      '`BLOCK_NOT_FOUND`: not one of mine, or already removed. Or `NOT_A_CHEF`.',
  })
  @ApiForbiddenResponse({ description: NOT_VERIFIED })
  @ApiClerkAuthResponses()
  removeBlock(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.agenda.removeBlock(user.userId, id);
  }
}
