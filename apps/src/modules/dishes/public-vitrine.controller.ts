import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

import { ApiGeoResponses } from '../../common/swagger/geo-responses';
import { TAGS } from '../../common/swagger/tags';
import {
  ChefShowcaseQueryDto,
  CoveringChefsQueryDto,
  WeekMenusQueryDto,
} from './dto/vitrine.dto';
import { MENU_ID, PUBLIC_DISH_EXAMPLE } from './swagger-examples';
import { VitrineService } from './vitrine.service';

const CHEF_ID = 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';

const CARD_DISH = {
  ...PUBLIC_DISH_EXAMPLE,
  name: 'Pho Bo',
  description: 'Bouillon de bœuf parfumé, nouilles de riz et herbes fraîches.',
  continent: 'asia',
  country: 'VN',
  portions: 4,
  allergens: ['gluten', 'soy'],
  customAllergens: [],
};

const CHEF_CARD = {
  id: CHEF_ID,
  displayName: 'Ivy Siyaptze',
  city: 'Nice',
  regionCode: '93',
  badges: ['haccp', 'insured'],
  sessionsDone: 30,
  newcomer: false,
  avatarUrl: `https://photos.labsfood.fr/users/a0eebc99…/avatar/ph_9f2a1c4e7b30d85a61c2e4f7.jpg`,
  acceptsCesu: true,
  rating: null,
  reviewCount: null,
  languages: ['fr', 'en'],
};

const WEEK_EXAMPLE = {
  week: { start: '2026-09-21', end: '2026-09-27' },
  data: [
    {
      menuId: MENU_ID,
      hasMenu: true,
      chef: CHEF_CARD,
      title: 'Tour du monde en sept plats',
      pitch:
        'Une semaine qui voyage : Vietnam, Sénégal, Tunisie, puis retour en Provence.',
      coveredDiets: ['lactose-free'],
      shoppingIncluded: true,
      sessionFromCents: 15000,
      afterTaxCreditCents: 7500,
      slotsLeft: 2,
      dishes: [CARD_DISH],
    },
  ],
  meta: {
    page: 1,
    limit: 20,
    total: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
};

const PUBLIC_MENU = {
  id: MENU_ID,
  title: 'Tour du monde en sept plats',
  pitch: 'Une semaine qui voyage.',
  period: 'week',
  shoppingIncluded: true,
  coveredDiets: ['lactose-free'],
  dishes: [CARD_DISH],
};

const ApiChefIdParam = () =>
  ApiParam({
    name: 'id',
    description: 'The batch cooker id (chef profile).',
    example: CHEF_ID,
  });

/**
 * The public site (FLOW-02 §5). No token: nothing here ever shows a recipe, a
 * draft, a suspended dish, or a batch cooker who is not approved and online.
 */
@Controller()
// Public and unauthenticated, so rate-limited per route and IP. The app has one
// throttler, sized for sign-ups (5 an hour): its limits are raised here.
@UseGuards(ThrottlerGuard)
@Throttle({ register: { limit: 60, ttl: 60_000 } })
export class PublicVitrineController {
  constructor(private readonly vitrine: VitrineService) {}

  @Get('menus/week')
  @ApiTags(TAGS.catalog)
  @ApiOperation({
    summary: 'List the week’s cooks and their menus',
    description:
      'The `/menu` page: one card per batch cooker for the week, rather than an ' +
      'anonymous list of dishes. Public: no token needed.\n\n' +
      '- Only approved batch cookers who are online, cover the area and are not fully ' +
      'booked. `slotsLeft` is the whole sessions still free that week, from their ' +
      'agenda, at the length of their shortest active offer; `null` means no working ' +
      'hours or no active offer: available on request.\n' +
      '- `hasMenu: false` marks a cook with no menu this week: shown last, with their ' +
      'published dishes.\n' +
      '- `coveredDiets` is what **every** dish satisfies, and `diets` filters on it.\n' +
      '- The order rotates once a month, the same for everyone, so the same cooks are ' +
      'not always first.\n' +
      '- Never a recipe: no ingredients, no steps. No prep or cook time and no ' +
      'calories either; `portions` stays.\n\n' +
      '`avatarUrl` is the profile photo, `null` until the batch cooker adds one. ' +
      '`rating` and `reviewCount` are empty until reviews exist. `languages` are codes ' +
      'from `GET /referentials/languages`, `[]` until the batch cooker sets them. ' +
      '`acceptsCesu`: the cook takes prefinanced CESU (details on ' +
      '`GET /chefs/{id}/cesu-info`). ' +
      '`sessionFromCents` is the cheapest service offer, before commission.\n\n' +
      'Example: `?week=2026-09-21&region=93&diets=vegetarian&shoppingIncluded=true`.',
  })
  @ApiOkResponse({ description: 'The week and its cards.', example: WEEK_EXAMPLE })
  getWeek(@Query() query: WeekMenusQueryDto) {
    return this.vitrine.week(query);
  }

  @Get('chefs')
  @ApiTags(TAGS.catalog)
  @ApiOperation({
    summary: 'List the batch cookers who cover a town',
    description:
      'For the custom request form: the client gives the town of the prestation ' +
      'first, then picks among the batch cookers who work there. Approved and online ' +
      'only, covering the commune through a whole-region zone or one that lists the ' +
      'town. Names only, sorted by name; a chef fully booked this week is still ' +
      'listed, a request is for any date. Public.\n\n' +
      'The commune is checked against the official base (geo.api.gouv.fr): a town ' +
      'the postcode does not serve is refused, `ADDRESS_CITY_MISMATCH`.\n\n' +
      'Example: `?postalCode=77127&city=Lieusaint`.',
  })
  @ApiOkResponse({
    description: 'The batch cookers covering the town, possibly none.',
    example: { data: [{ id: CHEF_ID, displayName: 'Ivy Siyaptze', city: 'Nice' }] },
  })
  @ApiUnprocessableEntityResponse({
    description:
      '`ADDRESS_CITY_MISMATCH`: the town is not a commune of the postcode; `communes` ' +
      'names those it serves.',
  })
  @ApiGeoResponses()
  listCovering(@Query() query: CoveringChefsQueryDto) {
    return this.vitrine.covering(query);
  }

  @Get('chefs/:id')
  @ApiTags(TAGS.catalog)
  @ApiOperation({
    summary: 'Get a batch cooker’s public page',
    description:
      'Profile, badges from the documents Lab’s Food validated, the areas covered, ' +
      'the active service offers (book one with `serviceOfferId`), and published ' +
      'dishes and menus. Never a draft, a suspended dish or a recipe. ' +
      '`slotsLeft` counts this week as on the week’s cards. Public.',
  })
  @ApiChefIdParam()
  @ApiOkResponse({
    description: 'The public page.',
    example: {
      ...CHEF_CARD,
      bio: 'Cuisinière depuis douze ans, surtout méditerranéen.',
      zones: [
        {
          regionCode: '93',
          regionLabel: "Provence-Alpes-Côte d'Azur",
          scope: 'cities',
          cities: [{ name: 'Nice', insee: '06088' }],
        },
      ],
      slotsLeft: 2,
      sessionFromCents: 15000,
      afterTaxCreditCents: 7500,
      serviceOffers: [
        {
          id: '9c3ebc99-9c0b-4ef8-bb6d-6bb9bd380a99',
          name: 'Session 4 heures',
          description: 'Trois plats de saison, cuisinés chez vous.',
          durationMinutes: 240,
          priceCents: 18000,
          shoppingIncluded: true,
          shoppingFeeCents: 1500,
          mealsIncluded: 3,
          clientPriceCents: 19500,
          afterTaxCreditCents: 9750,
        },
      ],
      dishes: [CARD_DISH],
      menus: [PUBLIC_MENU],
    },
  })
  @ApiNotFoundResponse({ description: 'No approved, online batch cooker with this id.' })
  getChef(@Param('id', ParseUUIDPipe) id: string) {
    return this.vitrine.chef(id);
  }

  @Get('chefs/:id/showcase')
  @ApiTags(TAGS.catalog)
  @ApiOperation({
    summary: 'See which menu a batch cooker shows each week',
    description:
      'Their "Vitrine du mois", for the public page. A week whose menu is not ' +
      'published shows `menu: null`. By default eight weeks from this one; 26 at ' +
      'most. Public.',
  })
  @ApiChefIdParam()
  @ApiOkResponse({
    description: 'The weeks.',
    example: {
      from: '2026-09-28',
      to: '2026-11-16',
      weeks: [
        { weekStart: '2026-09-28', menu: PUBLIC_MENU },
        { weekStart: '2026-10-05', menu: null },
      ],
    },
  })
  @ApiUnprocessableEntityResponse({
    description: '`to` before `from`, or over 26 weeks.',
  })
  @ApiNotFoundResponse({ description: 'No approved, online batch cooker with this id.' })
  getShowcase(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() range: ChefShowcaseQueryDto,
  ) {
    return this.vitrine.showcase(id, range);
  }
}
