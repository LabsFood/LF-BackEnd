import { X509Certificate } from 'crypto';
import { readFileSync } from 'fs';
import { rootCertificates } from 'tls';

import { postgresPoolConfig, prismaCliUrl, SUPABASE_CA_FILE } from './db-connection';

// No password in fixtures: secret scanners flag any credential-shaped Postgres URL.
const POOLER =
  'postgresql://postgres.ref@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true';
const LOCAL = 'postgresql://lf:lf@localhost:5432/lf_backend';

describe('db-connection', () => {
  it('ships the Supabase Root 2021 CA, unaltered', () => {
    const ca = new X509Certificate(readFileSync(SUPABASE_CA_FILE));
    expect(ca.subject).toContain('CN=Supabase Root 2021 CA');
    expect(ca.fingerprint256).toBe(
      '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA',
    );
  });

  describe('postgresPoolConfig', () => {
    it('verifies Supabase certificates against the Supabase CA and the public roots', () => {
      const { connectionString, ssl } = postgresPoolConfig(POOLER);
      expect(connectionString).toBe(POOLER);
      expect(ssl?.rejectUnauthorized).toBe(true);
      expect(ssl?.ca).toEqual([
        ...rootCertificates,
        readFileSync(SUPABASE_CA_FILE, 'utf8'),
      ]);
    });

    it('drops URL TLS parameters, which node-postgres would apply over `ssl`', () => {
      const { connectionString } = postgresPoolConfig(
        `${POOLER}&sslmode=no-verify&sslrootcert=/tmp/other.crt`,
      );
      const params = new URL(connectionString).searchParams;
      expect(params.has('sslmode')).toBe(false);
      expect(params.has('sslrootcert')).toBe(false);
      expect(params.get('pgbouncer')).toBe('true');
      expect(new URL(connectionString).username).toBe('postgres.ref');
    });

    it('leaves local Postgres alone', () => {
      expect(postgresPoolConfig(LOCAL)).toEqual({ connectionString: LOCAL });
    });
  });

  describe('prismaCliUrl', () => {
    it('makes the Prisma CLI verify Supabase certificates against the CA file', () => {
      const params = new URL(prismaCliUrl(`${POOLER}&sslaccept=accept_invalid_certs`))
        .searchParams;
      expect(params.get('sslmode')).toBe('require');
      expect(params.get('sslaccept')).toBe('strict');
      expect(params.get('sslcert')).toBe(SUPABASE_CA_FILE);
      expect(params.get('pgbouncer')).toBe('true');
    });

    it('leaves local Postgres alone', () => {
      expect(prismaCliUrl(LOCAL)).toBe(LOCAL);
    });
  });
});
