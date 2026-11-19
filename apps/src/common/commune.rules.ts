/**
 * Postcodes and towns against the official commune base (geo.api.gouv.fr). Pure: the
 * lookup is `GeoService`, the decision is here. Shared by every address the API
 * stores — candidature, client profile, bookings, custom requests — and by the
 * candidature's zone towns.
 */

/** A commune as geo.api.gouv.fr returns it: official name, INSEE code, department. */
export interface Commune {
  nom: string;
  code: string;
  codeDepartement: string;
  /** Asked for, but not required: a fixture or an older answer may lack it. */
  codeRegion?: string;
}

/** Case, accents, hyphens and apostrophes do not tell two commune names apart. */
export const communeKey = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * The commune a typed town names among those a postcode serves, or `undefined`:
 * `93100` + `Marseille` finds nothing. `communes` comes from the official base
 * (geo.api.gouv.fr), so an unknown postcode serves none.
 */
export function matchCommune(
  city: string,
  communes: readonly Commune[],
): Commune | undefined {
  const key = communeKey(city);
  return communes.find((commune) => communeKey(commune.nom) === key);
}
