/**
 * CORS allowlist — exact origins only (scheme + host + port).
 *
 * A browser matches an origin as an exact string: `http://localhost:3007` and
 * `http://localhost:3000` are two different origins, and so are `labsfood.fr`
 * and `www.labsfood.fr`. No wildcards, no regex — every site that calls this API
 * from a browser must be listed here (or added through `CORS_ORIGINS`).
 *
 * Consumed by `enableCors()` in `main.ts` and by Clerk's `authorizedParties`
 * (`auth/clerk-auth.guard.ts`), both via `cors.origins` from the config loader.
 */

/** Local dev frontends. Excluded when `ENVIRONMENT=production`. */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';


export const DEVELOPMENT_ORIGINS: readonly string[] = [
  // labsfood-web (Next.js) — `next dev -p 3007` / `next start -p 3007`
  'http://localhost:3007',
  'http://127.0.0.1:3007',
  // batchcooking-web (Next.js) — `next dev -p 3005`
  'http://localhost:3005',
  'http://127.0.0.1:3005',
  // Next.js default port — `next start` without `-p`, NEXTAUTH_URL / NEXT_PUBLIC_SITE_URL
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

/** Deployed frontends. Allowed in every environment. */
export const PRODUCTION_ORIGINS: readonly string[] = [
  // labsfood-web
  'https://labsfood.fr',
  // admin Dashboard (Next.js) — `next start -p 3006` / Vercel preview deploys
  'https://admin.labsfood.fr',
  // batchcooking-web
  'https://batchcooking.labsfood.fr',
];

/** Origins are compared case-insensitively and without a trailing slash. */
const normalize = (origin: string): string =>
  origin.trim().replace(/\/+$/, '').toLowerCase();

/**
 * Built-in allowlist plus anything in `CORS_ORIGINS` (comma-separated).
 * Use `CORS_ORIGINS` for one-off hosts — preview deploys, tunnels, staging —
 * and this file for the origins that are part of the product.
 */
export function resolveAllowedOrigins(
  rawEnvOrigins?: string,
  environment?: string,
): string[] {
  const builtIn =
    environment === 'production'
      ? PRODUCTION_ORIGINS
      : [...PRODUCTION_ORIGINS, ...DEVELOPMENT_ORIGINS];

  const fromEnv = (rawEnvOrigins ?? '')
    .split(',')
    .map(normalize)
    .filter((origin) => origin.length > 0);

  return [...new Set([...builtIn, ...fromEnv])];
}

/**
 * Requests without an `Origin` header (curl, server-to-server, webhooks) are not
 * cross-origin browser traffic, so CORS does not apply to them.
 */
export function isOriginAllowed(
  origin: string | undefined,
  allowedOrigins: readonly string[],
): boolean {
  if (!origin) return true;
  return allowedOrigins.includes(normalize(origin));
}

/**
 * Every method the routes use. `@fastify/cors` announces only GET, HEAD and POST
 * unless told otherwise, and the browser then cancels a PATCH, PUT or DELETE
 * before sending it: no request reaches the server, so no error shows up there.
 */
const CORS_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * What `main.ts` hands to `enableCors()`. Built here so the CORS spec runs the
 * real configuration rather than a copy of it — a copy is how the missing
 * `methods` went unnoticed.
 */
export function corsOptions(
  allowedOrigins: readonly string[],
  onRejected?: (origin: string | undefined) => void,
): NonNullable<Parameters<NestFastifyApplication['enableCors']>[0]> {
  return {
    origin: (origin: string | undefined, callback) => {
      const allowed = isOriginAllowed(origin, allowedOrigins);
      if (!allowed) onRejected?.(origin);
      callback(null, allowed);
    },
    methods: CORS_METHODS,
    credentials: true,
  };
}
