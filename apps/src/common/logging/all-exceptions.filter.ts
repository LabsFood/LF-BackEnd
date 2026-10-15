import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** Refusals worth graphing (`SLOT_UNAVAILABLE`, `BOOKING_PAID`): logged at `warn`. */
const BUSINESS_REFUSALS = new Set<number>([
  HttpStatus.CONFLICT,
  HttpStatus.UNPROCESSABLE_ENTITY,
  HttpStatus.TOO_MANY_REQUESTS,
]);

interface Answer {
  status: number;
  body: Record<string, unknown>;
}

/**
 * The one place an HTTP error is logged and answered.
 *
 * - Bodies are what Nest would send, plus `requestId`, so support can find the line.
 * - An unexpected error is a 500 `{code: 'INTERNAL'}` and never shows its stack.
 * - 5xx log at `error` with the stack; 409, 422 and 429 at `warn`; other 4xx at `debug`.
 *   Only the status, `code` and route are logged for a refusal, never its message,
 *   which may quote what the caller typed.
 *
 * HTTP only: Nest never applies global filters to WebSocket gateways.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpErrors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const { status, body } = answerFor(exception);
    const event = {
      event: 'http.error',
      status,
      code: body.code,
      method: request.method,
      route: request.routeOptions?.url,
    };

    if (status >= 500) {
      this.logger.error(
        {
          ...event,
          error: exception instanceof Error ? exception.name : typeof exception,
        },
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else if (BUSINESS_REFUSALS.has(status)) {
      this.logger.warn(event);
    } else {
      this.logger.debug(event);
    }

    if (reply.sent) return;
    void reply.status(status).send({ ...body, requestId: request.id });
  }
}

function answerFor(exception: unknown): Answer {
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const response = exception.getResponse();
    return {
      status,
      body:
        typeof response === 'object'
          ? (response as Record<string, unknown>)
          : { statusCode: status, message: response },
    };
  }
  // Errors from Fastify or its plugins carry their own 4xx (payload too large…),
  // as Nest's default filter honours.
  const { statusCode, message } = (exception ?? {}) as {
    statusCode?: unknown;
    message?: unknown;
  };
  if (
    typeof statusCode === 'number' &&
    statusCode >= 400 &&
    statusCode < 500 &&
    typeof message === 'string'
  ) {
    return { status: statusCode, body: { statusCode, message } };
  }
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    body: {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL',
      message: 'Internal server error',
    },
  };
}
