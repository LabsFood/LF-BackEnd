import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { METROPOLITAN_REGIONS } from './domain/chef-onboarding.rules';

/**
 * Metropolitan regions, INSEE codes (FLOW-01 §9.4).
 *
 * Served from the API so the frontend can drop its hard-coded copy. A static list
 * rather than a table: it changes when France reorganises its regions, which is
 * not a release cadence worth a migration.
 */
export { METROPOLITAN_REGIONS };

@ApiTags('referentials')
@Controller('referentials')
export class ReferentialsController {
  @Get('regions')
  @ApiOperation({
    summary: 'Metropolitan regions (public)',
    description:
      'The closed list `interventionZones[].regionCode` is validated against. Replaces ' +
      'the frontend’s hard-coded copy.',
  })
  @ApiOkResponse({ description: 'Region codes and labels.' })
  regions() {
    return { regions: METROPOLITAN_REGIONS };
  }
}
