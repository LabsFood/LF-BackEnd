import type { FastifyRequest } from 'fastify';

export const CLERK_WEBHOOK_PATH = '/webhooks/clerk';
export const STRIPE_WEBHOOK_PATH = '/webhooks/stripe';

/**
 * Routes whose raw request body is captured by the `preParsing` hook in `main.ts`.
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
