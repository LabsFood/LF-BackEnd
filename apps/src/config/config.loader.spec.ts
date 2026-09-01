import { DEVELOPMENT_ORIGINS, PRODUCTION_ORIGINS } from './allowed-origins';
import { configLoader } from './config.loader';

describe('configLoader', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('appends CORS_ORIGINS to the built-in allowlist, trimmed', () => {
    process.env.CORS_ORIGINS = 'http://a.test, http://b.test ,http://c.test';
    const cfg = configLoader();
    expect(cfg.cors.origins).toEqual(
      expect.arrayContaining(['http://a.test', 'http://b.test', 'http://c.test']),
    );
    expect(cfg.cors.origins).toEqual(expect.arrayContaining([...PRODUCTION_ORIGINS]));
  });

  it('falls back to the built-in allowlist when CORS_ORIGINS is unset', () => {
    delete process.env.CORS_ORIGINS;
    process.env.ENVIRONMENT = 'development';
    expect(configLoader().cors.origins).toEqual([
      ...PRODUCTION_ORIGINS,
      ...DEVELOPMENT_ORIGINS,
    ]);
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

  it('reads both Stripe webhook signing secrets', () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_account';
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect';
    expect(configLoader().stripe).toMatchObject({
      webhookSecret: 'whsec_account',
      connectWebhookSecret: 'whsec_connect',
    });
  });

  it('defaults the commission to 15 % HT plus 20 % VAT', () => {
    delete process.env.PAYMENTS_COMMISSION_RATE_BPS;
    delete process.env.PAYMENTS_COMMISSION_VAT_RATE_BPS;
    expect(configLoader().payments).toMatchObject({
      commissionRateBps: 1500,
      commissionVatRateBps: 2000,
    });
  });

  it('coerces the commission basis points to numbers', () => {
    process.env.PAYMENTS_COMMISSION_RATE_BPS = '1200';
    process.env.PAYMENTS_COMMISSION_VAT_RATE_BPS = '550';
    expect(configLoader().payments).toMatchObject({
      commissionRateBps: 1200,
      commissionVatRateBps: 550,
    });
  });

  it('points Connect onboarding redirects at batchcooking-web by default', () => {
    delete process.env.STRIPE_CONNECT_REFRESH_URL;
    delete process.env.STRIPE_CONNECT_RETURN_URL;
    const { payments } = configLoader();
    expect(payments.stripeConnectRefreshUrl).toContain('localhost:3005');
    expect(payments.stripeConnectReturnUrl).toContain('localhost:3005');
  });
});
