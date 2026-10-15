import { ConsoleLogger, LogLevel } from '@nestjs/common';
import { hostname } from 'node:os';

import { currentRequest } from './request-context';

/**
 * Fields every log line carries, named as Datadog's reserved attributes so its
 * service, environment and deployment facets work unconfigured. `DD_*` win when an
 * agent is set up; until then Railway's own variables fill them.
 */
export const LOG_BASE = {
  service: process.env.DD_SERVICE ?? 'lf-api',
  env: process.env.DD_ENV ?? process.env.ENVIRONMENT ?? 'development',
  version: process.env.DD_VERSION ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? 'local',
  hostname: hostname(),
};

interface JsonOptions {
  context: string;
  logLevel: LogLevel;
  writeStreamType?: 'stdout' | 'stderr';
  errorStack?: unknown;
}

/** The stack to log beside an event, for whatever was thrown. */
export const stackOf = (error: unknown): string | undefined =>
  error instanceof Error ? error.stack : String(error);

const isEvent = (message: unknown): message is Record<string, unknown> =>
  typeof message === 'object' && message !== null && !Array.isArray(message);

/**
 * Nest's JSON logger plus the request it ran in and the deployment it came from.
 *
 * A business event is logged as an object, one per line:
 * `logger.log({ event: 'booking.created', bookingId, ms })`. Its fields land at the
 * top level, where an aggregator facets on them, and `event` becomes the message.
 * Never put names, emails, phone numbers, addresses, notes or tokens in one: ids,
 * codes, counts and durations only.
 */
export class AppLogger extends ConsoleLogger {
  protected override getJsonLogObject(message: unknown, options: JsonOptions) {
    const line = super.getJsonLogObject(message, options);
    const request = currentRequest();
    return {
      ...(isEvent(message) ? message : {}),
      ...line,
      // `info`, as pino writes it: one name per level across the stream. Nest's type
      // has no `info`, hence the cast; only the JSON line sees it.
      level: (line.level === 'log' ? 'info' : line.level) as LogLevel,
      message: isEvent(message) ? (message.event ?? message.message ?? '') : message,
      ...LOG_BASE,
      ...(request && {
        requestId: request.requestId,
        userId: request.userId,
        method: request.method,
        route: request.route,
      }),
    };
  }
}
