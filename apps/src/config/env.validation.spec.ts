import { envValidationSchema } from './env.validation';

const REQUIRED = {
  SUPABASE_DB_URL: 'postgres://localhost:5432/db',
};

describe('envValidationSchema — CLERK_SECRET_KEY in production', () => {
  it('rejects a missing/malformed key in production', () => {
    const { error } = envValidationSchema.validate(
      { ...REQUIRED, ENVIRONMENT: 'production', CLERK_SECRET_KEY: 'not-a-real-key' },
      { allowUnknown: true, abortEarly: false },
    );
    expect(error?.message).toMatch(/CLERK_SECRET_KEY/);
  });

  it('accepts a well-formed key in production', () => {
    const { error } = envValidationSchema.validate(
      { ...REQUIRED, ENVIRONMENT: 'production', CLERK_SECRET_KEY: 'sk_live_abc123' },
      { allowUnknown: true, abortEarly: false },
    );
    expect(error).toBeUndefined();
  });

  it('still allows an empty/missing key outside production', () => {
    const { error } = envValidationSchema.validate(
      { ...REQUIRED, ENVIRONMENT: 'development' },
      { allowUnknown: true, abortEarly: false },
    );
    expect(error).toBeUndefined();
  });
});

describe('envValidationSchema — ENVIRONMENT', () => {
  // Only develop and production are deployed; staging was retired on 2026-11-10.
  it('refuses staging', () => {
    const { error } = envValidationSchema.validate(
      { ...REQUIRED, ENVIRONMENT: 'staging' },
      { allowUnknown: true, abortEarly: false },
    );
    expect(error?.message).toMatch(/ENVIRONMENT/);
  });
});

describe('envValidationSchema — URSSAF_GATEWAY', () => {
  const validate = (env: Record<string, string>) =>
    envValidationSchema.validate(
      { ...REQUIRED, ...env },
      { allowUnknown: true, abortEarly: false },
    );

  it('is disabled unless asked for', () => {
    expect(validate({}).value.URSSAF_GATEWAY).toBe('disabled');
  });

  it('can be simulated on the test deployment, which runs as production too', () => {
    const { error } = validate({
      ENVIRONMENT: 'production',
      CLERK_SECRET_KEY: 'sk_test_abc123',
      STRIPE_SECRET_KEY: 'sk_test_abc123',
      URSSAF_GATEWAY: 'simulated',
    });
    expect(error).toBeUndefined();
  });

  it('is never simulated beside live Stripe keys', () => {
    const { error } = validate({
      STRIPE_SECRET_KEY: 'sk_live_abc123',
      URSSAF_GATEWAY: 'simulated',
    });
    expect(error?.message).toMatch(/URSSAF_GATEWAY/);
  });
});

describe('envValidationSchema — SUPABASE_SECRET_KEY', () => {
  const validate = (env: Record<string, string>) =>
    envValidationSchema.validate(
      { ...REQUIRED, ...env },
      { allowUnknown: true, abortEarly: false },
    );

  it('accepts a secret API key', () => {
    expect(validate({ SUPABASE_SECRET_KEY: 'sb_secret_x' }).error).toBeUndefined();
  });

  it('refuses the legacy service_role JWT, so the legacy keys can stay off', () => {
    const { error } = validate({
      SUPABASE_SECRET_KEY: 'legacy-service-role-jwt',
    });
    expect(error?.message).toMatch(/SUPABASE_SECRET_KEY must be a Supabase secret key/);
  });

  it('stays optional', () => {
    expect(validate({ SUPABASE_SECRET_KEY: '' }).error).toBeUndefined();
    expect(validate({}).error).toBeUndefined();
  });
});
