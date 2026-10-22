import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ConnectionOptions, rootCertificates } from 'node:tls';

/** Shared Postgres URL helpers (no secrets logged). */

export const isSupabasePoolerUrl = (url: string): boolean =>
  url.includes('pgbouncer=true') || /:6543\//.test(url);

export const isSupabaseCloudUrl = (url: string): boolean => url.includes('supabase.co');

export const isLocalPostgresUrl = (url: string): boolean =>
  /@(localhost|127\.0\.0\.1|postgres)(:|\/)/.test(url);

/**
 * Supabase Root 2021 CA: it signs the certificate of every Supabase Postgres host, direct
 * and pooler. Public (Dashboard → Database → SSL Configuration), valid until 2031-04-26.
 * `../../certs` is `apps/certs` from `src/supabase` (scripts, tests, prisma.config.ts) and
 * from `dist/supabase` (the API) alike.
 */
export const SUPABASE_CA_FILE = join(
  __dirname,
  '..',
  '..',
  'certs',
  'supabase-prod-ca-2021.crt',
);

/** URL parameters node-postgres turns into TLS settings, overriding the `ssl` option. */
const PG_URL_TLS_PARAMS = [
  'ssl',
  'sslmode',
  'sslcert',
  'sslkey',
  'sslrootcert',
  'sslnegotiation',
  'uselibpqcompat',
];

export interface PostgresPoolConfig {
  connectionString: string;
  ssl?: ConnectionOptions;
}

/**
 * node-postgres settings for a database URL. On Supabase the server certificate is
 * verified, hostname included, against the Supabase CA (the public roots stay trusted in
 * case Supabase moves to a public CA). TLS parameters are taken out of the URL, since
 * node-postgres would let them replace this `ssl`.
 */
export function postgresPoolConfig(url: string): PostgresPoolConfig {
  if (!isSupabaseCloudUrl(url)) {
    return { connectionString: url };
  }
  const parsed = new URL(url);
  const hasTlsParams = PG_URL_TLS_PARAMS.some((param) => parsed.searchParams.has(param));
  PG_URL_TLS_PARAMS.forEach((param) => parsed.searchParams.delete(param));
  return {
    connectionString: hasTlsParams ? parsed.toString() : url,
    ssl: {
      ca: [...rootCertificates, readFileSync(SUPABASE_CA_FILE, 'utf8')],
      rejectUnauthorized: true,
    },
  };
}

/**
 * Database URL for the Prisma CLI (`migrate deploy` at container start, studio). Its
 * built-in driver accepts any certificate unless `sslaccept=strict`; `sslcert` is the CA
 * it then verifies against.
 */
export function prismaCliUrl(url: string): string {
  if (!isSupabaseCloudUrl(url)) {
    return url;
  }
  const parsed = new URL(url);
  parsed.searchParams.set('sslmode', 'require');
  parsed.searchParams.set('sslaccept', 'strict');
  parsed.searchParams.set('sslcert', SUPABASE_CA_FILE);
  return parsed.toString();
}
