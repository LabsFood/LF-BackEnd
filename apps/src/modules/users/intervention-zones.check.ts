import { UnprocessableEntityException } from '@nestjs/common';

import { GeoService } from '../../integrations/geo.service';
import {
  interventionZonesProblem,
  zoneCitiesProblem,
} from '../chef-onboarding/domain/chef-onboarding.rules';
import { InterventionZoneDto } from '../chef-onboarding/dto/create-chef-application.dto';

/**
 * The candidature's rules on zones, for a change after approval, by the batch cooker
 * or an admin: the regions and cities rule, then each town against the official
 * commune base (geo.api.gouv.fr). Throws the typed 422 the candidature would.
 */
export async function assertInterventionZones(
  zones: InterventionZoneDto[],
  geo: GeoService,
): Promise<void> {
  const problem = interventionZonesProblem(zones);
  if (problem) {
    throw new UnprocessableEntityException({
      code: 'VALIDATION_FAILED',
      message: problem,
    });
  }
  for (const zone of zones) {
    if (zone.cities.length === 0) continue;
    const unknown = zoneCitiesProblem(zone, await geo.communesByRegion(zone.regionCode));
    if (unknown) {
      throw new UnprocessableEntityException({
        code: 'ZONE_CITY_UNKNOWN',
        message: unknown,
      });
    }
  }
}

/** Zones by region label, towns by name, French collation: the page lists them so. */
export function sortZones(zones: InterventionZoneDto[]): InterventionZoneDto[] {
  const fr = (a: string, b: string) => a.localeCompare(b, 'fr');
  return [...zones]
    .map((zone) => ({
      ...zone,
      cities: [...zone.cities].sort((a, b) => fr(a.name, b.name)),
    }))
    .sort((a, b) => fr(a.regionLabel, b.regionLabel));
}
