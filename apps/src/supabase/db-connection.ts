/** Shared Postgres URL helpers (no secrets logged). */

export const isSupabasePoolerUrl = (url: string): boolean =>
  url.includes('pgbouncer=true') || /:6543\//.test(url);

export const isSupabaseCloudUrl = (url: string): boolean => url.includes('supabase.co');

export const isLocalPostgresUrl = (url: string): boolean =>
  /@(localhost|127\.0\.0\.1|postgres)(:|\/)/.test(url);

export const postgresSsl = (url: string): { rejectUnauthorized: false } | undefined =>
  isSupabaseCloudUrl(url) ? { rejectUnauthorized: false } : undefined;
