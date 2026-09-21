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
