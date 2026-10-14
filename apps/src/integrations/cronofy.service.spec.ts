import { ConfigService } from '@nestjs/config';

import { CronofyService } from './cronofy.service';

const fakeConfig = (overrides: Record<string, unknown> = {}) =>
  ({
    get: jest.fn((key: string, defaultValue?: unknown) => {
      const map: Record<string, unknown> = {
        'cronofy.clientId': overrides.clientId,
        'cronofy.clientSecret': overrides.clientSecret,
        'cronofy.dataCenter': overrides.dataCenter ?? 'us',
      };
      const value = map[key];
      return value === undefined ? defaultValue : value;
    }),
  }) as unknown as ConfigService;

describe('CronofyService', () => {
  it('reports unconfigured when keys are missing', () => {
    const svc = new CronofyService(fakeConfig({}));
    expect(svc.configured).toBe(false);
  });

  it('reports configured when both client id and secret are set', () => {
    const svc = new CronofyService(fakeConfig({ clientId: 'cid', clientSecret: 'csec' }));
    expect(svc.configured).toBe(true);
  });

  it('uses the US base URL by default', () => {
    const svc = new CronofyService(fakeConfig({}));
    expect(svc.baseUrl).toBe('https://api-cronofy.com/v1');
  });

  it('prefixes regional data centres other than us', () => {
    const svc = new CronofyService(fakeConfig({ dataCenter: 'de' }));
    expect(svc.baseUrl).toBe('https://api-de-cronofy.com/v1');
  });
});
