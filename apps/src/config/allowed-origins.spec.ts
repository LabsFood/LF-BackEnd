import {
  DEVELOPMENT_ORIGINS,
  PRODUCTION_ORIGINS,
  isOriginAllowed,
  resolveAllowedOrigins,
} from './allowed-origins';

describe('resolveAllowedOrigins', () => {
  it('includes the deployed and local frontends outside production', () => {
    const origins = resolveAllowedOrigins(undefined, 'development');
    expect(origins).toEqual([...PRODUCTION_ORIGINS, ...DEVELOPMENT_ORIGINS]);
  });

  it('drops localhost origins in production', () => {
    const origins = resolveAllowedOrigins(undefined, 'production');
    expect(origins).toEqual([...PRODUCTION_ORIGINS]);
    expect(origins.some((origin) => origin.includes('localhost'))).toBe(false);
  });

  it('appends CORS_ORIGINS entries, trimmed and de-duplicated', () => {
    const origins = resolveAllowedOrigins(
      ' https://preview.labsfood.fr , https://labsfood.fr/ ,,https://tunnel.test',
      'production',
    );
    expect(origins).toEqual([
      ...PRODUCTION_ORIGINS,
      'https://preview.labsfood.fr',
      'https://tunnel.test',
    ]);
  });
});

describe('isOriginAllowed', () => {
  const allowed = resolveAllowedOrigins(undefined, 'development');

  it('matches an exact origin, port included', () => {
    expect(isOriginAllowed('http://localhost:3007', allowed)).toBe(true);
    expect(isOriginAllowed('http://localhost:3005', allowed)).toBe(true);
    expect(isOriginAllowed('https://batchcooking.labsfood.fr', allowed)).toBe(true);
  });

  it('rejects the right host on the wrong port or scheme', () => {
    expect(isOriginAllowed('http://localhost:4200', allowed)).toBe(false);
    expect(isOriginAllowed('http://labsfood.fr', allowed)).toBe(false);
    expect(isOriginAllowed('https://evil.labsfood.fr.attacker.test', allowed)).toBe(
      false,
    );
  });

  it('ignores a trailing slash and casing', () => {
    expect(isOriginAllowed('https://LabsFood.fr/', allowed)).toBe(true);
  });

  it('allows requests without an Origin header (curl, webhooks)', () => {
    expect(isOriginAllowed(undefined, allowed)).toBe(true);
  });
});
