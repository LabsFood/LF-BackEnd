import { Controller, Get, Header, NotFoundException, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { TAGS } from '../../common/swagger/tags';
import { GeoService } from '../../integrations/geo.service';
import {
  isMetropolitanRegion,
  METROPOLITAN_REGIONS,
} from './domain/chef-onboarding.rules';
import {
  ALLERGENS,
  COMPUTED_DIETS,
  DIETS,
  DISH_CATEGORIES,
} from '../dishes/domain/dishes.rules';
import { STEP_TYPES } from '../dishes/domain/recipes.rules';
import { LANGUAGES } from '../users/dto/chef-profile.dto';

/**
 * Metropolitan regions, INSEE codes (FLOW-01 §9.4).
 *
 * Served from the API so the frontend can drop its hard-coded copy. A static list
 * rather than a table: it changes when France reorganises its regions, which is
 * not a release cadence worth a migration.
 */
export { METROPOLITAN_REGIONS };

/** A dropdown reads alphabetically; French collation puts « Île » under I. */
const byLabel = <T extends { label: string }>(rows: readonly T[]): T[] =>
  [...rows].sort((a, b) => a.label.localeCompare(b.label, 'fr'));

const DAY_MS = 24 * 60 * 60 * 1000;

@ApiTags(TAGS.referentials)
@Controller('referentials')
export class ReferentialsController {
  /** One entry per metropolitan region (13 at most): a commune list changes yearly. */
  private readonly communesCache = new Map<
    string,
    { at: number; rows: Promise<{ name: string; insee: string; department: string }[]> }
  >();

  constructor(private readonly geo: GeoService) {}

  @Get('regions')
  @ApiOperation({
    summary: 'List the regions a batch cooker can cover',
    description:
      'The 13 regions of metropolitan France, with their official INSEE code. The ' +
      'candidature form shows these labels and sends the `code` in ' +
      '`interventionZones[].regionCode`; any other code is refused. Public.',
  })
  @ApiOkResponse({
    description: 'Every region, as code and label.',
    schema: {
      example: {
        regions: [
          { code: '11', label: 'Île-de-France' },
          { code: '84', label: 'Auvergne-Rhône-Alpes' },
          { code: '93', label: "Provence-Alpes-Côte d'Azur" },
        ],
      },
    },
  })
  regions() {
    return { regions: byLabel(METROPOLITAN_REGIONS) };
  }

  @Get('regions/:code/communes')
  @Header('Cache-Control', 'public, max-age=86400')
  @ApiOperation({
    summary: 'List every commune of a region',
    description:
      'All the communes of a metropolitan region (code from `GET /referentials/regions`), ' +
      'alphabetical, from the official commune base. `name` and `insee` are what ' +
      '`interventionZones[].cities` takes. Kept 24 h in memory, so a region is fetched ' +
      'upstream once a day. 404 `REGION_NOT_FOUND` for any other code, 502/504 ' +
      '`GEO_UNAVAILABLE` when the official base fails. Public.',
  })
  @ApiParam({ name: 'code', example: '11' })
  @ApiOkResponse({
    description: 'Every commune, as name, INSEE code and department.',
    schema: {
      example: { communes: [{ name: 'Arpajon', insee: '91021', department: '91' }] },
    },
  })
  async communes(@Param('code') code: string) {
    if (!isMetropolitanRegion(code)) {
      throw new NotFoundException({
        code: 'REGION_NOT_FOUND',
        message: `"${code}" is not a metropolitan region code; see GET /referentials/regions.`,
      });
    }
    const hit = this.communesCache.get(code);
    if (hit && Date.now() - hit.at < DAY_MS) return { communes: await hit.rows };

    const rows = this.geo
      .communesByRegion(code)
      .then((communes) =>
        communes
          .map((c) => ({ name: c.nom, insee: c.code, department: c.codeDepartement }))
          .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
      );
    this.communesCache.set(code, { at: Date.now(), rows });
    // A failure must not be remembered for a day: drop it so the next visitor retries.
    rows.catch(() => this.communesCache.delete(code));
    return { communes: await rows };
  }

  @Get('allergens')
  @ApiOperation({
    summary: 'List the 14 regulated allergens',
    description:
      'The allergens food law requires to be declared, in the order of the ' +
      'regulation. A dish sends the `code` in `allergens`; anything else goes in ' +
      '`customAllergens`. Public.',
  })
  @ApiOkResponse({
    description: 'Every allergen, as code and label.',
    schema: {
      example: {
        allergens: [
          { code: 'gluten', label: 'Céréales contenant du gluten' },
          { code: 'milk', label: 'Lait' },
        ],
      },
    },
  })
  allergens() {
    return { allergens: ALLERGENS };
  }

  @Get('diets')
  @ApiOperation({
    summary: 'List the diets a dish can claim',
    description:
      'A dish sends the `code` in `diets`; anything else goes in `customDiets`. The ' +
      'public menu filter takes the same codes. Public.',
  })
  @ApiOkResponse({
    description: 'Every diet, as code and label.',
    schema: {
      example: {
        diets: [
          { code: 'vegetarian', label: 'Végétarien' },
          { code: 'gluten-free', label: 'Sans gluten' },
        ],
      },
    },
  })
  diets() {
    return { diets: DIETS };
  }

  @Get('dish-categories')
  @ApiOperation({
    summary: 'List the dish categories',
    description: 'Where a dish sits in a meal, for `category`. Public.',
  })
  @ApiOkResponse({
    description: 'Every category, as code and label.',
    schema: {
      example: {
        categories: [
          { code: 'starter', label: 'Entrée' },
          { code: 'main', label: 'Plat' },
        ],
      },
    },
  })
  categories() {
    return { categories: DISH_CATEGORIES };
  }

  @Get('computed-diets')
  @ApiOperation({
    summary: 'List the diets computed from the common ingredient list',
    description:
      'Recettes §4.8: what an ingredient of the common list may suit, and what a ' +
      'dish shows when all its ingredients share it. Public.',
  })
  @ApiOkResponse({
    description: 'Every diet, as code and label.',
    schema: { example: { diets: [{ code: 'vegan', label: 'Végétalien' }] } },
  })
  computedDiets() {
    return { diets: COMPUTED_DIETS };
  }

  @Get('step-types')
  @ApiOperation({
    summary: 'List the step types of a recipe',
    description:
      'What a recipe step is (Recettes §4.5), for `steps[].type`. A step without a ' +
      'type keeps the recipe from being ready. Public.',
  })
  @ApiOkResponse({
    description: 'Every type, as code and label.',
    schema: {
      example: {
        stepTypes: [
          { code: 'preparation', label: 'Préparation' },
          { code: 'cuisson', label: 'Cuisson' },
        ],
      },
    },
  })
  stepTypes() {
    return { stepTypes: STEP_TYPES };
  }

  @Get('languages')
  @ApiOperation({
    summary: 'List the languages a batch cooker can speak',
    description:
      'ISO 639-1 codes. A batch cooker sends the `code` in `languages` on ' +
      '`PATCH /me/chef-profile`; any other code is refused. The public pages give ' +
      'the codes, labelled from here. Public.',
  })
  @ApiOkResponse({
    description: 'Every language, as code and label.',
    schema: {
      example: {
        languages: [
          { code: 'fr', label: 'Français' },
          { code: 'en', label: 'Anglais' },
        ],
      },
    },
  })
  languages() {
    return { languages: byLabel(LANGUAGES) };
  }
}
