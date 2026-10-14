import Fastify, { type FastifyInstance } from 'fastify';

import {
  getWebhookRawBody,
  registerWebhookRawBodyHook,
  type RawBodyFastifyRequest,
} from './fastify-raw-body';

/**
 * Regression cover for a crash that took the whole process down: the `preParsing`
 * hook used to return a Buffer, and Fastify's content-type parser calls `.on('data')`
 * on whatever it gets back — so every POST to a webhook route threw
 * `payload.on is not a function` and exited Node. Both webhooks 502'd in production.
 */
describe('registerWebhookRawBodyHook', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    registerWebhookRawBodyHook(app);

    app.post('/webhooks/clerk', async (request) => ({
      raw: getWebhookRawBody(request as RawBodyFastifyRequest),
      body: request.body,
    }));
    app.post('/webhooks/stripe', async (request) => ({
      raw: getWebhookRawBody(request as RawBodyFastifyRequest),
    }));
    app.post('/bookings', async (request) => ({
      raw: (request as RawBodyFastifyRequest).rawBody ?? null,
      body: request.body,
    }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('answers the request instead of crashing the process', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/clerk',
      headers: { 'content-type': 'application/json' },
      payload: '{"type":"user.created"}',
    });

    expect(response.statusCode).toBe(200);
  });

  it('preserves the exact bytes a signature is computed over', async () => {
    // Odd spacing and a non-ASCII character: re-serialising this would change the
    // bytes and break both Svix and Stripe signature verification.
    const payload = '{"type":"user.created",  "name":"KEVIN OLINGÄ"}';

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/clerk',
      headers: { 'content-type': 'application/json' },
      payload,
    });

    expect(response.json().raw).toBe(payload);
  });

  it('still parses the JSON body downstream', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/clerk',
      headers: { 'content-type': 'application/json' },
      payload: '{"type":"user.created"}',
    });

    expect(response.json().body).toEqual({ type: 'user.created' });
  });

  it('covers the Stripe route as well as the Clerk one', async () => {
    const payload = '{"id":"evt_1"}';

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json' },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().raw).toBe(payload);
  });

  it('leaves non-webhook routes untouched', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/bookings',
      headers: { 'content-type': 'application/json' },
      payload: '{"priceCents":12500}',
    });

    expect(response.json()).toEqual({ raw: null, body: { priceCents: 12500 } });
  });
});
