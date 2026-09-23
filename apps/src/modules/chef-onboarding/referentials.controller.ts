import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { TAGS } from '../../common/swagger/tags';
import { METROPOLITAN_REGIONS } from './domain/chef-onboarding.rules';

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
}
