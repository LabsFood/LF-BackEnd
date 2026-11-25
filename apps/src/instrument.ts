/**
 * Sentry, before anything else loads: the SDK patches http, pg, fastify and Nest as
 * they are first required, so `main.ts` imports this file on its first line.
 *
 * Errors reach Sentry through `AppLogger.error` (common/logging/app-logger.ts).
 * Without `SENTRY_DSN` the SDK stays off and every capture is a no-op. It is read
 * from the real environment (Railway, or the shell), not from `.env`: ConfigModule
 * loads that file after this one has run.
 */
import * as Sentry from '@sentry/nestjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // The deployed develop API runs with ENVIRONMENT=production (strict Clerk checks), so
  // SENTRY_ENVIRONMENT=develop keeps its events, traces and check-ins out of production.
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.ENVIRONMENT ?? 'development',
  // The deployment the log lines name as `version` (LOG_BASE in app-logger.ts).
  release: process.env.DD_VERSION ?? process.env.RAILWAY_GIT_COMMIT_SHA,
  tracesSampleRate: process.env.ENVIRONMENT === 'production' ? 0.1 : 1,
});
