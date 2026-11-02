import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { TAGS } from '../../common/swagger/tags';
import { METROPOLITAN_REGIONS } from './domain/chef-onboarding.rules';
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

@ApiTags(TAGS.referentials)
@Controller('referentials')
export class ReferentialsController {
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
    return { regions: METROPOLITAN_REGIONS };
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
    return { languages: LANGUAGES };
  }
}
