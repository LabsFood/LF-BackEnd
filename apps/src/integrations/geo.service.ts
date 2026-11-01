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
const TIMEOUT_MS = 5000;
const FIELDS = 'fields=nom,code,codeDepartement';

/** How geo.api.gouv.fr failed, as the response and the log line say it. */
type GeoFailure = 'timeout' | 'unreachable' | 'http-error' | 'invalid-response';

const FAILED: Record<GeoFailure, string> = {
  timeout: `did not answer within ${TIMEOUT_MS / 1000} s`,
  unreachable: 'could not be reached',
  'http-error': 'answered with an error',
  'invalid-response': 'sent an answer that is not a list of communes',
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
    lookup: 'postcode' | 'region',
    reason: GeoFailure,
    started: number,
    extra: { upstreamStatus?: number; detail?: string },
  ) {
    this.logger.error({
      event: 'geo.lookup_failed',
      upstream: UPSTREAM,
      lookup,
      reason,
      ...extra,
      durationMs: Date.now() - started,
    });
    const body = {
      code: 'GEO_UNAVAILABLE',
      message: `${UPSTREAM}, the official commune base, ${FAILED[reason]}: the address could not be checked and nothing was saved. Try again in a moment.`,
      upstream: UPSTREAM,
      reason,
      ...(extra.upstreamStatus !== undefined && { upstreamStatus: extra.upstreamStatus }),
    };
    return reason === 'timeout'
      ? new GatewayTimeoutException(body)
      : new BadGatewayException(body);
  }
}
