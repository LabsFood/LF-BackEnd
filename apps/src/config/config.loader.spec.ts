import { configLoader } from './config.loader';

describe('configLoader', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('parses CORS_ORIGINS into a trimmed list', () => {
    process.env.CORS_ORIGINS = 'http://a.test, http://b.test ,http://c.test';
    const cfg = configLoader();
    expect(cfg.cors.origins).toEqual(['http://a.test', 'http://b.test', 'http://c.test']);
  });

  it('falls back to localhost when CORS_ORIGINS is unset', () => {
    delete process.env.CORS_ORIGINS;
    expect(configLoader().cors.origins).toEqual(['http://localhost:3000']);
  });

  it('coerces API_PORT to a number', () => {
    process.env.API_PORT = '9090';
    delete process.env.PORT;
    expect(configLoader().api.port).toBe(9090);
  });

  it('falls back to PORT when API_PORT is unset (Railway)', () => {
    delete process.env.API_PORT;
    process.env.PORT = '3000';
    expect(configLoader().api.port).toBe(3000);
  });

  it('defaults Cronofy data centre to us', () => {
    delete process.env.CRONOFY_DATA_CENTER;
    expect(configLoader().cronofy.dataCenter).toBe('us');
  });
});
