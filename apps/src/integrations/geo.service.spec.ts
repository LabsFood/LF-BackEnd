import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';

import { GeoService } from './geo.service';

describe('GeoService', () => {
  const montreuil = {
    nom: 'Montreuil',
    code: '93048',
    codeDepartement: '93',
    codeRegion: '11',
  };
  let fetchMock: jest.SpyInstance;
  const geo = new GeoService();

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });
  afterEach(() => fetchMock.mockRestore());

  const answer = (status: number, body: unknown) =>
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));

  it('asks geo.api.gouv.fr for the communes a postcode serves', async () => {
    answer(200, [montreuil]);

    await expect(geo.communesByPostcode('93100')).resolves.toEqual([montreuil]);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://geo.api.gouv.fr/communes?codePostal=93100&fields=nom,code,codeDepartement,codeRegion',
    );
  });

  it('asks for every commune of a region', async () => {
    answer(200, [montreuil]);

    await geo.communesByRegion('11');
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://geo.api.gouv.fr/communes?codeRegion=11&fields=nom,code,codeDepartement,codeRegion',
    );
  });

  describe('assertCommune — one check for every address the API stores', () => {
    it('refuses a town the postcode does not serve, naming those it does', async () => {
      answer(200, [montreuil]);

      const error = await geo
        .assertCommune('93100', 'Marseille', 'addressCity')
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).toEqual({
        code: 'ADDRESS_CITY_MISMATCH',
        message: 'addressCity is not a commune of postcode 93100.',
        communes: ['Montreuil'],
      });
    });

    it('accepts the commune however it is typed, and returns it', async () => {
      answer(200, [montreuil]);
      await expect(
        geo.assertCommune(' 93100 ', 'montreuil', 'addressCity'),
      ).resolves.toEqual(montreuil);
      expect(String(fetchMock.mock.calls[0][0])).toContain('codePostal=93100&');
    });

    it.each([
      [undefined, 'Montreuil'],
      ['93100', null],
      ['', ''],
    ])(
      'has nothing to check while half the address is missing (%p, %p)',
      async (postcode, city) => {
        await expect(
          geo.assertCommune(postcode, city, 'addressCity'),
        ).resolves.toBeUndefined();
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );
  });

  describe('a failure of geo.api.gouv.fr is reported as one', () => {
    let logged: jest.SpyInstance;
    beforeEach(() => {
      logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => logged.mockRestore());

    const failure = (lookup: () => Promise<unknown>): Promise<HttpException> =>
      lookup().then(
        () => {
          throw new Error('expected the lookup to fail');
        },
        (e: unknown) => e as HttpException,
      );

    it.each([
      [
        'answers an error',
        () => answer(500, { message: 'Internal' }),
        { reason: 'http-error', upstreamStatus: 500 },
      ],
      [
        'cannot be reached',
        () =>
          fetchMock.mockRejectedValue(
            new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }),
          ),
        { reason: 'unreachable' },
      ],
      [
        'sends something that is not a list of communes',
        () => answer(200, { message: 'maintenance' }),
        { reason: 'invalid-response', upstreamStatus: 200 },
      ],
    ])('502 when the API %s, naming it and why', async (_label, arrange, why) => {
      arrange();

      const error = await failure(() => geo.communesByPostcode('93100'));
      expect(error).toBeInstanceOf(BadGatewayException);
      expect(error.getResponse()).toMatchObject({
        code: 'GEO_UNAVAILABLE',
        upstream: 'geo.api.gouv.fr',
        ...why,
      });
    });

    it('504 when the API does not answer in time', async () => {
      fetchMock.mockRejectedValue(
        Object.assign(new Error('The operation was aborted due to timeout'), {
          name: 'TimeoutError',
        }),
      );

      const error = await failure(() => geo.communesByRegion('84'));
      expect(error).toBeInstanceOf(GatewayTimeoutException);
      expect(error.getResponse()).toMatchObject({
        code: 'GEO_UNAVAILABLE',
        upstream: 'geo.api.gouv.fr',
        reason: 'timeout',
      });
    });

    it('logs the upstream, the lookup, the cause and the time taken — never the postcode', async () => {
      fetchMock.mockRejectedValue(
        new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }),
      );

      await failure(() => geo.communesByPostcode('93100'));
      expect(logged).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'geo.lookup_failed',
          upstream: 'geo.api.gouv.fr',
          lookup: 'postcode',
          reason: 'unreachable',
          detail: 'fetch failed (ECONNRESET)',
          durationMs: expect.any(Number),
        }),
      );
      expect(JSON.stringify(logged.mock.calls)).not.toContain('93100');
    });
  });

  describe('checkStreet — the street must exist in the postcode, spelling forgiven', () => {
    const hit = (score: number) => ({ features: [{ properties: { score } }] });

    it('asks the Géoplateforme for the best match of the street in the postcode', async () => {
      answer(200, hit(0.9));

      await geo.checkStreet('12 rue de la Paix', ' 75002 ', 'addressLine');

      const url = new URL(String(fetchMock.mock.calls[0][0]));
      expect(url.origin + url.pathname).toBe('https://data.geopf.fr/geocodage/search');
      expect(url.searchParams.get('q')).toBe('12 rue de la Paix');
      expect(url.searchParams.get('postcode')).toBe('75002');
      expect(url.searchParams.get('limit')).toBe('1');
    });

    it.each([0.32, 0.4, 0.83])(
      'accepts a loose match (score %p): typos, lieux-dits',
      async (score) => {
        answer(200, hit(score));
        await expect(geo.checkStreet('rue Hoche', '93100', 'addressLine')).resolves.toBe(
          true,
        );
      },
    );

    it.each([
      ['nothing found', { features: [] }],
      ['a match too weak to be that street', hit(0.2)],
    ])(
      'keeps an address with %s, with a warning that names neither',
      async (_why, body) => {
        const warned = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
        answer(200, body);

        await expect(
          geo.checkStreet('azerty qwerty', '33000', 'addressLine'),
        ).resolves.toBe(false);
        const [[line]] = warned.mock.calls as unknown as [[Record<string, unknown>]];
        expect(line).toMatchObject({
          event: 'geo.street_not_found',
          field: 'addressLine',
        });
        expect(JSON.stringify(line)).not.toMatch(/azerty|33000/);
        warned.mockRestore();
      },
    );

    it.each([
      [undefined, '75002'],
      ['12 rue de la Paix', null],
      ['  ', '75002'],
    ])(
      'has nothing to check while half the address is missing (%p, %p)',
      async (line, postcode) => {
        await expect(geo.checkStreet(line, postcode, 'addressLine')).resolves.toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it('fails closed, naming the Géoplateforme, and never logs the street or postcode', async () => {
      const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      fetchMock.mockResolvedValue(new Response('down', { status: 503 }));

      const error = await geo
        .checkStreet('12 rue de la Paix', '75002', 'addressLine')
        .catch((e: HttpException) => e);

      expect(error).toBeInstanceOf(BadGatewayException);
      expect((error as HttpException).getResponse()).toMatchObject({
        code: 'GEO_UNAVAILABLE',
        upstream: 'data.geopf.fr',
        reason: 'http-error',
      });
      expect(logged).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'geo.lookup_failed', lookup: 'street' }),
      );
      expect(JSON.stringify(logged.mock.calls)).not.toMatch(/Paix|75002/);
      logged.mockRestore();
    });

    it('fails closed on an answer that is not a list of matches', async () => {
      answer(200, { nope: true });
      await expect(
        geo.checkStreet('12 rue de la Paix', '75002', 'addressLine'),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });
  });
});
