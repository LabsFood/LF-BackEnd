import {
  ArgumentsHost,
  ConflictException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { fastify } from 'fastify';

import { AllExceptionsFilter } from './all-exceptions.filter';
import { AppLogger } from './app-logger';
import { currentRequest, registerRequestContext } from './request-context';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

function captureStdout(): {
  lines: () => Record<string, unknown>[];
  restore: () => void;
} {
  const written: string[] = [];
  const spy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    written.push(String(chunk));
    return true;
  });
  return {
    lines: () => written.map((l) => JSON.parse(l) as Record<string, unknown>),
    restore: () => spy.mockRestore(),
  };
}

describe('request context', () => {
  it('survives body parsing and awaits, and tags AppLogger lines', async () => {
    const app = fastify({ genReqId: () => 'req-1' });
    registerRequestContext(app);
    const logger = new AppLogger('Bookings', { json: true });
    let seen: unknown;
    app.post('/chef/bookings/:id', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen = currentRequest();
      logger.log({ event: 'booking.created', bookingId: 'b-1' });
      return { ok: true };
    });

    const out = captureStdout();
    let res;
    try {
      res = await app.inject({
        method: 'POST',
        url: '/chef/bookings/b-1?q=jean@example.com',
        payload: { persons: 2 },
      });
    } finally {
      out.restore();
    }

    expect(res.headers['x-request-id']).toBe('req-1');
    expect(seen).toEqual({
      requestId: 'req-1',
      method: 'POST',
      route: '/chef/bookings/:id',
    });
    const [line] = out.lines();
    expect(line).toMatchObject({
      level: 'info',
      message: 'booking.created',
      event: 'booking.created',
      bookingId: 'b-1',
      context: 'Bookings',
      requestId: 'req-1',
      route: '/chef/bookings/:id',
      service: 'lf-api',
    });
    expect(JSON.stringify(line)).not.toContain('jean@example.com');
    await app.close();
  });

  it('is empty outside a request', () => {
    expect(currentRequest()).toBeUndefined();
  });
});

describe('AppLogger error reporting', () => {
  const captureException = Sentry.captureException as jest.Mock;
  const stack =
    'TypeError: boom\n    at BookingsService.notify (bookings.service.ts:12:3)';

  // Nest writes error lines to stderr and the rest to stdout.
  function silenced(run: () => unknown): unknown {
    const out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      return run();
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  }

  beforeEach(() => captureException.mockClear());

  it('reports an error line with its stack, request, user and logger context', async () => {
    const app = fastify({ genReqId: () => 'req-1' });
    registerRequestContext(app);
    const logger = new AppLogger({ json: true });
    app.get('/me/bookings/:id', async () => {
      currentRequest()!.userId = 'user_2abc';
      // As `new Logger('BookingsService').error(...)` forwards it: context last.
      logger.error(
        { event: 'booking.mail_failed', bookingId: 'b-1' },
        stack,
        'BookingsService',
      );
      return {};
    });

    await silenced(() => app.inject({ method: 'GET', url: '/me/bookings/b-1' }));
    await app.close();

    expect(captureException).toHaveBeenCalledTimes(1);
    const [error, hint] = captureException.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('BookingsService');
    expect(error.message).toBe('booking.mail_failed (TypeError: boom)');
    expect(error.stack).toBe(stack);
    expect(hint).toEqual({
      tags: { requestId: 'req-1', route: '/me/bookings/:id' },
      user: { id: 'user_2abc' },
      extra: { event: 'booking.mail_failed', bookingId: 'b-1' },
    });
  });

  it('tags the failing step and error code of an event', () => {
    silenced(() =>
      new AppLogger({ json: true }).error(
        {
          event: 'stripe.v2_call_failed',
          step: 'create_account',
          code: 'account_token_required',
          statusCode: 400,
        },
        undefined,
        'StripeAccountsV2',
      ),
    );
    const [, hint] = captureException.mock.calls[0];
    expect(hint.tags).toEqual({
      requestId: undefined,
      route: undefined,
      step: 'create_account',
      code: 'account_token_required',
    });
  });

  it('reports an Error passed as the message as it is', () => {
    const thrown = new RangeError('out of slots');
    silenced(() => new AppLogger({ json: true }).error(thrown));
    expect(captureException).toHaveBeenCalledWith(thrown, expect.anything());
  });

  it('keeps email addresses out of what it reports', () => {
    silenced(() =>
      new AppLogger({ json: true }).error(
        'Brevo rejected "welcome" for jean.dupont+test@example.fr: 400',
        undefined,
        'BrevoService',
      ),
    );
    const [error] = captureException.mock.calls[0];
    expect(error.message).toBe('Brevo rejected "welcome" for [email]: 400');
    expect(error.stack).not.toContain('example.fr');
  });

  it('does not report warn, log or debug lines', () => {
    const logger = new AppLogger({ json: true, logLevels: ['log', 'warn', 'debug'] });
    silenced(() => {
      logger.warn({ event: 'http.error', status: 409 });
      logger.log({ event: 'booking.created' });
      logger.debug({ event: 'http.error', status: 404 });
    });
    expect(captureException).not.toHaveBeenCalled();
  });
});

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  function run(exception: unknown) {
    const reply = {
      sent: false,
      status: jest.fn().mockReturnThis(),
      type: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({
          id: 'req-9',
          method: 'PATCH',
          routeOptions: { url: '/me/bookings/:id' },
        }),
        getResponse: () => reply,
      }),
    } as unknown as ArgumentsHost;
    filter.catch(exception, host);
    return {
      status: reply.status.mock.calls[0]?.[0],
      type: reply.type.mock.calls[0]?.[0],
      body: reply.send.mock.calls[0]?.[0],
    };
  }

  afterEach(() => jest.restoreAllMocks());

  it('keeps a refusal body, adds requestId, and logs the code at warn', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const answer = run(
      new ConflictException({ code: 'BOOKING_PAID', message: 'Ask support.' }),
    );
    expect(answer).toEqual({
      status: 409,
      // JSON even where the route announced another type (the calendar feed).
      type: 'application/json; charset=utf-8',
      body: { code: 'BOOKING_PAID', message: 'Ask support.', requestId: 'req-9' },
    });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'http.error', status: 409, code: 'BOOKING_PAID' }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Ask support.');
  });

  it('logs other 4xx at debug, with the body Nest would send', () => {
    const debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    expect(run(new NotFoundException('No such booking.')).body).toEqual({
      statusCode: 404,
      message: 'No such booking.',
      error: 'Not Found',
      requestId: 'req-9',
    });
    expect(debug).toHaveBeenCalled();
  });

  it('answers an unexpected error with 500 INTERNAL, never its stack', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const answer = run(new TypeError('boom at db row 42'));
    expect(answer).toEqual({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      type: 'application/json; charset=utf-8',
      body: {
        statusCode: 500,
        code: 'INTERNAL',
        message: 'Internal server error',
        requestId: 'req-9',
      },
    });
    expect(error.mock.calls[0][1]).toContain('boom at db row 42');
  });

  it("keeps a Fastify error's own 4xx", () => {
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    const tooLarge = Object.assign(new Error('Request body is too large'), {
      statusCode: 413,
    });
    expect(run(tooLarge).status).toBe(413);
  });
});
