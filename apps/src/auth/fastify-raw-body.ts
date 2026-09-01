import { Readable } from 'node:stream';

import type { FastifyInstance, FastifyRequest } from 'fastify';

export const CLERK_WEBHOOK_PATH = '/webhooks/clerk';
export const STRIPE_WEBHOOK_PATH = '/webhooks/stripe';

/**
 * Routes whose raw request body is captured before parsing.
 * Both Clerk (Svix) and Stripe verify their signature against the exact bytes sent,
 * so a re-serialised JSON body would fail verification.
 */
export const WEBHOOK_RAW_BODY_PATHS = [CLERK_WEBHOOK_PATH, STRIPE_WEBHOOK_PATH];

export type RawBodyFastifyRequest = FastifyRequest & { rawBody?: Buffer };

export function getWebhookRawBody(req: RawBodyFastifyRequest): string {
  const raw = req.rawBody;
  if (!raw || raw.length === 0) {
    throw new Error('Missing raw webhook body (preParsing hook not registered).');
  }
  return raw.toString('utf8');
}

/**
 * Stashes the untouched request bytes on `request.rawBody` for the webhook routes.
 *
 * `preParsing` must return a **stream**: Fastify's content-type parser calls
 * `.on('data')` on whatever comes back. Returning the Buffer itself throws
 * `payload.on is not a function` inside Fastify and takes the process down with it,
 * so the consumed bytes are replayed as a fresh stream for the JSON parser.
 */
export function registerWebhookRawBodyHook(fastify: FastifyInstance): void {
  fastify.addHook('preParsing', async (request, _reply, payload) => {
    if (!WEBHOOK_RAW_BODY_PATHS.some((path) => request.url?.startsWith(path))) {
      return payload;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of payload) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const rawBody = Buffer.concat(chunks);
    (request as RawBodyFastifyRequest).rawBody = rawBody;

    // `[rawBody]`, not `rawBody`: `Readable.from` iterates a Buffer byte by byte.
    return Readable.from([rawBody]);
  });
}
