import { ConfigService } from '@nestjs/config';

import { CronofyError, CronofyService } from './cronofy.service';

const KEY = Buffer.alloc(32, 1).toString('base64');

const fakeConfig = (overrides: Record<string, unknown> = {}) =>
  ({
    get: jest.fn((key: string, defaultValue?: unknown) => {
      const map: Record<string, unknown> = {
        'cronofy.clientId': overrides.clientId,
        'cronofy.clientSecret': overrides.clientSecret,
        'cronofy.dataCenter': overrides.dataCenter,
        'cronofy.redirectUri': overrides.redirectUri,
        'cronofy.tokenKey': overrides.tokenKey,
      };
      const value = map[key];
      return value === undefined ? defaultValue : value;
    }),
  }) as unknown as ConfigService;

const READY = {
  clientId: 'cid',
  clientSecret: 'csec',
  redirectUri: 'https://batchcooking.labsfood.fr/espace-chef/agenda/cronofy',
  tokenKey: KEY,
};

describe('CronofyService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('is configured only with the id, secret, redirect and a 32-byte key', () => {
    expect(new CronofyService(fakeConfig({})).configured).toBe(false);
    expect(
      new CronofyService(fakeConfig({ ...READY, tokenKey: 'c2hvcnQ=' })).configured,
    ).toBe(false);
    expect(new CronofyService(fakeConfig(READY)).configured).toBe(true);
  });

  it('talks to the EU data center by default, the UK one when asked', () => {
    const de = new CronofyService(fakeConfig(READY));
    expect(de.apiUrl).toBe('https://api-de.cronofy.com');
    expect(de.appUrl).toBe('https://app-de.cronofy.com');

    const uk = new CronofyService(fakeConfig({ ...READY, dataCenter: 'uk' }));
    expect(uk.apiUrl).toBe('https://api-uk.cronofy.com');
  });

  it('sends the batch cooker to agree with our scopes and state', () => {
    const url = new URL(new CronofyService(fakeConfig(READY)).authorizeUrl('st4te'));

    expect(url.origin + url.pathname).toBe('https://app-de.cronofy.com/oauth/authorize');
    expect(url.searchParams.get('scope')).toBe(
      'read_free_busy create_event delete_event',
    );
    expect(url.searchParams.get('state')).toBe('st4te');
    expect(url.searchParams.get('redirect_uri')).toBe(READY.redirectUri);
  });

  it('exchanges the code with the client credentials', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ access_token: 'a' }), { status: 200 }),
      );

    await new CronofyService(fakeConfig(READY)).exchangeCode('c0de');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api-de.cronofy.com/oauth/token');
    expect(JSON.parse(init!.body as string)).toEqual({
      client_id: 'cid',
      client_secret: 'csec',
      grant_type: 'authorization_code',
      code: 'c0de',
      redirect_uri: READY.redirectUri,
    });
  });

  it('follows the free/busy pages, and only within the Cronofy API', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            free_busy: [{ start: 'a', end: 'b', free_busy_status: 'busy' }],
            pages: { next_page: 'https://api-de.cronofy.com/v1/free_busy/pages/2' },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            free_busy: [{ start: 'c', end: 'd', free_busy_status: 'tentative' }],
          }),
        ),
      );

    const blocks = await new CronofyService(fakeConfig(READY)).freeBusy(
      'tok',
      new Date('2026-10-20T08:00:00Z'),
      new Date('2026-10-21T08:00:00Z'),
    );

    expect(blocks).toHaveLength(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('from=2026-10-20&to=2026-10-22');
  });

  it('tells an expired grant apart from other refusals', () => {
    expect(new CronofyError(400, '{"error":"invalid_grant"}').invalidGrant).toBe(true);
    expect(new CronofyError(401, 'nope').invalidGrant).toBe(false);
  });
});
