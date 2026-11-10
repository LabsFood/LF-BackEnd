import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';

import { Commune, matchCommune } from '../common/commune.rules';

/** Official commune base (INSEE COG + La Poste postcodes), public, no key. */
const UPSTREAM = 'geo.api.gouv.fr';
const GEO_API = `https://${UPSTREAM}`;
/** Official address base (Géoplateforme geocoder, the BAN's successor), public, no key. */
const GEOCODER = 'data.geopf.fr';
const GEOCODER_API = `https://${GEOCODER}/geocodage`;
/**
 * Below this a match is a stranger's street, not a typo: 0.32 is a lieu-dit,
 * 0.38 a flat with its building, 0.42 « bld » for « boulevard »; gibberish has no
 * match at all. Deliberately loose: a real address refused costs a booking, a
 * doubtful one accepted costs a phone call. Raise it if fake streets slip through.
 */
const MIN_STREET_SCORE = 0.3;
const TIMEOUT_MS = 5000;
const FIELDS = 'fields=nom,code,codeDepartement';

/** How geo.api.gouv.fr failed, as the response and the log line say it. */
type GeoFailure = 'timeout' | 'unreachable' | 'http-error' | 'invalid-response';

const FAILED: Record<GeoFailure, string> = {
  timeout: `did not answer within ${TIMEOUT_MS / 1000} s`,
  unreachable: 'could not be reached',
  'http-error': 'answered with an error',
  'invalid-response': 'sent an answer that could not be read',
};

/** `AbortSignal.timeout` rejects with a `TimeoutError`, while connecting or reading. */
const isTimeout = (error: unknown): boolean =>
  (error as { name?: unknown } | null)?.name === 'TimeoutError';

/** `fetch failed (ENOTFOUND)`: the message, and the socket's code when there is one. */
const detailOf = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof code === 'string' ? `${message} (${code})` : message;
};

const isCommuneList = (body: unknown): body is Commune[] =>
  Array.isArray(body) &&
  body.every(
    (c: Partial<Record<keyof Commune, unknown>> | null) =>
      typeof c?.nom === 'string' &&
      typeof c.code === 'string' &&
      typeof c.codeDepartement === 'string',
  );

/**
 * Checks addresses and towns against the official base. Fails closed: when the API
 * fails, the request is refused rather than stored unchecked — 504 if it was too
 * slow, 502 otherwise, `GEO_UNAVAILABLE` with `upstream` and `reason` either way, so
 * a failure of geo.api.gouv.fr never reads as one of ours.
 */
@Injectable()
export class GeoService {
  private readonly logger = new Logger(GeoService.name);

  /**
   * Refuses a town the postcode does not serve (`ADDRESS_CITY_MISMATCH`, naming
   * those it does): `93100` + `Marseille`. `field` names the town in the message.
   * Nothing to check while either half of the address is missing.
   */
  async assertCommune(
    postcode: string | null | undefined,
    city: string | null | undefined,
    field: string,
  ): Promise<void> {
    const code = postcode?.trim();
    if (!code || !city?.trim()) return;
    const communes = await this.communesByPostcode(code);
    if (!matchCommune(city, communes)) {
      throw new UnprocessableEntityException({
        code: 'ADDRESS_CITY_MISMATCH',
        message: `${field} is not a commune of postcode ${code}.`,
        communes: communes.map((commune) => commune.nom),
      });
    }
  }

  /**
   * Refuses a street the postcode has no trace of (`ADDRESS_NOT_FOUND`): « 5 avenue
   * des Fées Magiques » in 75001. Tolerant by design (see `MIN_STREET_SCORE`): it
   * rejects what the official base cannot place, not what it spells differently.
   * Nothing to check while either half is missing. Same fail-closed rule as above.
   */
  async assertStreet(
    line: string | null | undefined,
    postcode: string | null | undefined,
    field: string,
  ): Promise<void> {
    const street = line?.trim();
    const code = postcode?.trim();
    if (!street || !code) return;
    const score = await this.bestStreetScore(street, code);
    if (score === null || score < MIN_STREET_SCORE) {
      throw new UnprocessableEntityException({
        code: 'ADDRESS_NOT_FOUND',
        message: `${field} was not found in postcode ${code}.`,
      });
    }
  }

  /** The score of the best match of a street within a postcode; null when none. */
  async bestStreetScore(line: string, postcode: string): Promise<number | null> {
    const started = Date.now();
    const query = new URLSearchParams({ q: line, postcode, limit: '1' });
    let response: Response;
    try {
      response = await fetch(`${GEOCODER_API}/search?${query}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw this.failure(
        'street',
        isTimeout(error) ? 'timeout' : 'unreachable',
        started,
        {
          detail: detailOf(error),
        },
      );
    }
    const upstreamStatus = response.status;
    if (!response.ok)
      throw this.failure('street', 'http-error', started, { upstreamStatus });

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw this.failure(
        'street',
        isTimeout(error) ? 'timeout' : 'invalid-response',
        started,
        { upstreamStatus, detail: detailOf(error) },
      );
    }
    const features = (body as { features?: unknown } | null)?.features;
    if (!Array.isArray(features)) {
      throw this.failure('street', 'invalid-response', started, { upstreamStatus });
    }
    const scores = features
      .map((f: { properties?: { score?: unknown } } | null) => f?.properties?.score)
      .filter((score): score is number => typeof score === 'number');
    return scores.length ? Math.max(...scores) : null;
  }

  /** The communes a postcode serves; none for a postcode that does not exist. */
  communesByPostcode(postcode: string): Promise<Commune[]> {
    return this.get('postcode', `codePostal=${encodeURIComponent(postcode)}`);
  }

  /** Every commune of a region: about 250 KB for the largest, one call per region. */
  communesByRegion(regionCode: string): Promise<Commune[]> {
    return this.get('region', `codeRegion=${encodeURIComponent(regionCode)}`);
  }

  private async get(lookup: 'postcode' | 'region', filter: string): Promise<Commune[]> {
    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(`${GEO_API}/communes?${filter}&${FIELDS}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw this.failure(lookup, isTimeout(error) ? 'timeout' : 'unreachable', started, {
        detail: detailOf(error),
      });
    }
    const upstreamStatus = response.status;
    if (!response.ok) {
      throw this.failure(lookup, 'http-error', started, { upstreamStatus });
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw this.failure(
        lookup,
        isTimeout(error) ? 'timeout' : 'invalid-response',
        started,
        {
          upstreamStatus,
          detail: detailOf(error),
        },
      );
    }
    if (!isCommuneList(body)) {
      throw this.failure(lookup, 'invalid-response', started, { upstreamStatus });
    }
    return body;
  }

  /**
   * Logs the failure, then the exception to throw. The log line names the lookup kind,
   * never its value: a postcode belongs to someone's address.
   */
  private failure(
    lookup: 'postcode' | 'region' | 'street',
    reason: GeoFailure,
    started: number,
    extra: { upstreamStatus?: number; detail?: string },
  ) {
    const upstream = lookup === 'street' ? GEOCODER : UPSTREAM;
    const base = lookup === 'street' ? 'address base' : 'commune base';
    this.logger.error({
      event: 'geo.lookup_failed',
      upstream,
      lookup,
      reason,
      ...extra,
      durationMs: Date.now() - started,
    });
    const body = {
      code: 'GEO_UNAVAILABLE',
      message: `${upstream}, the official ${base}, ${FAILED[reason]}: the address could not be checked and nothing was saved. Try again in a moment.`,
      upstream,
      reason,
      ...(extra.upstreamStatus !== undefined && { upstreamStatus: extra.upstreamStatus }),
    };
    return reason === 'timeout'
      ? new GatewayTimeoutException(body)
      : new BadGatewayException(body);
  }
}
