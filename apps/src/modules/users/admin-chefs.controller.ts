import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
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
import { ApiAdminAuthResponses } from '../../common/swagger/auth-responses';
import { TAGS } from '../../common/swagger/tags';
import { AdminChefsService } from './admin-chefs.service';
import {
  CHEF_STATE_HELP,
  ListAdminChefsQueryDto,
  UpdateChefTierDto,
  UpdateChefZonesDto,
} from './dto/admin-chefs.dto';

const CHEF_ID = 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';

const CHEF = {
  id: CHEF_ID,
  userId: 'f5eebc99-9c0b-4ef8-bb6d-6bb9bd380a66',
  displayName: 'Marie Dupont',
  fullName: 'Marie Dupont',
  email: 'marie.dupont@exemple.fr',
  phone: '+33612345678',
  avatarUrl: null,
  city: 'Nice',
  state: 'online',
  isVerified: true,
  isActive: true,
  autoSuspendedAt: null,
  tier: 'tier_2',
  tierLabel: 'Confirmé',
  reactivatedPendingReview: false,
  regions: [{ code: '93', label: "Provence-Alpes-Côte d'Azur" }],
  application: {
    id: 'a1eebc99-9c0b-4ef8-bb6d-6bb9bd380a99',
    reference: 'CAND-2026-0042',
    status: 'approved',
  },
  counts: {
    publishedDishes: 12,
    publishedMenus: 3,
    upcomingBookings: 2,
    completedBookings: 9,
  },
  createdAt: '2026-09-21T08:30:00.000Z',
};

const CHEF_DETAIL = {
  ...CHEF,
  bio: 'Cuisine méditerranéenne de saison, formée à Lyon.',
  serviceRadiusKm: 30,
  sapPath: 'type-b',
  sapDeclarationNumber: null,
  crcesuAffiliationStatus: 'active',
  urssafTiersPrestationStatus: 'pending',
  zones: [
    {
      regionCode: '93',
      regionLabel: "Provence-Alpes-Côte d'Azur",
      scope: 'cities',
      cities: [
        { name: 'Nice', dept: '06', insee: '06088' },
        { name: 'Antibes', dept: '06', insee: '06004' },
        { name: 'Cannes', dept: '06', insee: '06029' },
      ],
    },
  ],
  payoutsConnected: false,
  calendarConnected: false,
  application: {
    ...CHEF.application,
    submittedAt: '2026-09-21T08:30:00.000Z',
    decidedAt: '2026-09-22T11:22:10.000Z',
  },
};

const ID_HELP =
  '`{id}` is the batch cooker page id (`chefProfile.id`), the same one the other ' +
  '`/admin/chefs/{id}/…` routes take. It is not the account id (`userId`) and not ' +
  'the candidature id.';

/**
 * The batch cookers of the platform, as the back office lists them. Only the
 * zones are written here: putting someone online is
 * `PATCH /admin/chefs/{id}/verification`, approving them is the candidature.
 */
@ApiTags(TAGS.adminChefs)
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard, AdminGuard)
@Controller('admin/chefs')
export class AdminChefsController {
  constructor(private readonly chefs: AdminChefsService) {}

  @Get()
  @ApiOperation({
    summary: 'List every batch cooker',
    description:
      'Every batch cooker account, approved or not, including the ones that never ' +
      'went through a candidature. Deleted accounts are left out.\n\n' +
      `Each one has a \`state\`. ${CHEF_STATE_HELP}\n\n` +
      'Search with `q`, narrow with `state` and `region`, order with `sort`. ' +
      '`counts` gives the published dishes and menus and the bookings ahead ' +
      '(`pending` or `confirmed`) and done. There is no rating: reviews do not ' +
      `exist yet.\n\n${ID_HELP}`,
  })
  @ApiOkResponse({
    description: 'One page of batch cookers.',
    example: {
      data: [CHEF],
      meta: {
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    },
  })
  @ApiAdminAuthResponses()
  list(@Query() query: ListAdminChefsQueryDto) {
    return this.chefs.list(query);
  }

  @Get('counts')
  @ApiOperation({
    summary: 'Count batch cookers by state',
    description: `For the tabs of the list. ${CHEF_STATE_HELP} \`all\` is their sum.`,
  })
  @ApiOkResponse({
    description: 'The counts.',
    example: { all: 24, online: 11, offline: 6, suspended: 1, pending: 6 },
  })
  @ApiAdminAuthResponses()
  counts() {
    return this.chefs.counts();
  }

  @Get(':id')
  @ApiParam({ name: 'id', description: 'The batch cooker page id.', example: CHEF_ID })
  @ApiOperation({
    summary: 'Read one batch cooker',
    description:
      'The list row, plus the bio, the zones covered city by city, the SAP route and ' +
      'whether payouts and calendar are connected.\n\n' +
      '`zones` has the shape `PATCH /admin/chefs/{id}/zones` takes: each city whole, ' +
      '`{ name, dept, insee }`, so a zone read here can be sent back unchanged.\n\n' +
      '`crcesuAffiliationStatus` and `urssafTiersPrestationStatus` read back what ' +
      '`PATCH /admin/chefs/{id}/sap-external-status` wrote (`not_started`, `pending`, ' +
      '`active`); both are `null` until the batch cooker has declared a SAP route.\n\n' +
      'The rest has its own route, each the single source of its data: the dossier ' +
      'and documents at `GET /admin/chef-applications/{application.id}`, the content ' +
      `at \`GET /admin/chefs/{id}/dishes\` and \`/menus\`.\n\n${ID_HELP}`,
  })
  @ApiOkResponse({ description: 'The batch cooker.', example: CHEF_DETAIL })
  @ApiNotFoundResponse({ description: 'No batch cooker with this id.' })
  @ApiAdminAuthResponses()
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.chefs.get(id);
  }

  @Patch(':id/zones')
  @ApiParam({ name: 'id', description: 'The batch cooker page id.', example: CHEF_ID })
  @ApiOperation({
    summary: 'Change the zones of an approved batch cooker',
    description:
      'For a batch cooker who moves or covers one more city. Replaces every zone, in ' +
      'the shape and with the rules of the candidature’s `interventionZones`. The ' +
      'batch cooker cannot do it themselves: the zones were checked against documents ' +
      'at the candidature. Audited.\n\n' +
      `Answers the batch cooker as \`GET /admin/chefs/{id}\` does.\n\n${ID_HELP}`,
  })
  @ApiOkResponse({
    description: 'The batch cooker, with the new zones.',
    example: CHEF_DETAIL,
  })
  @ApiNotFoundResponse({ description: '`CHEF_NOT_FOUND`: no batch cooker with this id.' })
  @ApiConflictResponse({
    description:
      '`CHEF_NOT_VERIFIED`: not approved yet. Until then the zones are the ' +
      'candidature’s: ask for changes on the candidature instead.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      '`VALIDATION_FAILED`: a region outside metropolitan France, or a `cities` zone ' +
      'without a city.',
  })
  @ApiAdminAuthResponses()
  setZones(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateChefZonesDto,
    @CurrentClerkUser() user: ClerkUser,
  ) {
    return this.chefs.setZones(id, body.interventionZones, user.userId);
  }

  @Patch(':id/tier')
  @ApiParam({ name: 'id', description: 'The batch cooker page id.', example: CHEF_ID })
  @ApiOperation({
    summary: 'Set the tier of a batch cooker',
    description:
      'One of four codes (`tier_1` to `tier_4`), named in ' +
      '`GET /admin/settings/chef-tiers`. Every batch cooker starts at `tier_1`. ' +
      'No billing and no publication rule depend on it yet. Audited.\n\n' +
      `Answers the batch cooker as \`GET /admin/chefs/{id}\` does.\n\n${ID_HELP}`,
  })
  @ApiOkResponse({
    description: 'The batch cooker, with the new tier.',
    example: CHEF_DETAIL,
  })
  @ApiNotFoundResponse({ description: '`CHEF_NOT_FOUND`: no batch cooker with this id.' })
  @ApiAdminAuthResponses()
  setTier(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateChefTierDto,
    @CurrentClerkUser() user: ClerkUser,
  ) {
    return this.chefs.setTier(id, body.tier, user.userId);
  }
}
