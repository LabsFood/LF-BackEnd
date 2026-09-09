import type { FastifyRequest } from 'fastify';

export const CLERK_WEBHOOK_PATH = '/webhooks/clerk';

export type RawBodyFastifyRequest = FastifyRequest & { rawBody?: Buffer };

export function getClerkWebhookRawBody(req: RawBodyFastifyRequest): string {
  const raw = req.rawBody;
  if (!raw || raw.length === 0) {
    throw new Error('Missing raw webhook body (preParsing hook not registered).');
  }
  return raw.toString('utf8');
}
