import { ConsoleLogger, LogLevel } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
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

/** Some lines still quote a recipient (Brevo): never let one reach Sentry. */
const redactEmails = (text: string): string =>
  text.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]');

/**
 * Sends an error line to Sentry. A no-op until `instrument.ts` has a `SENTRY_DSN`.
 *
 * Nest hands the stack over as a string, so an Error is rebuilt around it: Sentry
 * reads its frames and groups by where it broke, not by a message that holds ids.
 */
function reportError(message: unknown, params: unknown[], ownContext?: string): void {
  const texts = params.filter((p): p is string => typeof p === 'string');
  const stack = texts.find((text) => text.includes('\n    at '));
  // `new Logger('X').error(...)` passes its context last.
  const context = texts.filter((text) => text !== stack).at(-1) ?? ownContext;
  const request = currentRequest();

  let error: Error;
  if (message instanceof Error) {
    error = message;
  } else {
    const what = isEvent(message)
      ? String(message.event ?? message.message)
      : String(message);
    error = new Error(
      redactEmails(stack ? `${what} (${stack.split('\n', 1)[0]})` : what),
    );
    error.name = context ?? 'Error';
    if (stack) error.stack = redactEmails(stack);
  }

  Sentry.captureException(error, {
    tags: { requestId: request?.requestId, route: request?.route },
    user: request?.userId ? { id: request.userId } : undefined,
    // Event fields are ids, codes and counts by AppLogger's rule: safe to send.
    extra: isEvent(message) && !(message instanceof Error) ? message : undefined,
  });
}

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
  /**
   * Every `logger.error` in the app lands here: the 5xx of `AllExceptionsFilter`,
   * the failures services catch and only log (commission debits, invoices, cron
   * jobs…) and Nest's own WebSocket errors. Reporting from this one place means no
   * call site has to know about Sentry. `warn` and below are never reported, so
   * business refusals (409, 422, 429) stay out.
   */
  override error(message: unknown, ...params: unknown[]): void {
    super.error(message, ...params);
    reportError(message, params, this.context);
  }

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
