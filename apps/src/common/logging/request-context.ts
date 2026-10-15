import { AsyncLocalStorage, AsyncResource } from 'node:async_hooks';

import type { FastifyInstance, FastifyRequest } from 'fastify';

/** What every log line written while serving a request is tagged with. */
export interface RequestContext {
  requestId: string;
  method: string;
  /** The route pattern (`/chef/bookings/:id`), never the raw URL: no ids or tokens. */
  route?: string;
  /** The caller's Clerk id, set by `ClerkAuthGuard`. An opaque id, not personal data. */
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();
const scopes = new WeakMap<FastifyRequest, AsyncResource>();

/** The request being served, or undefined outside one (boot, cron jobs, WebSocket). */
export const currentRequest = (): RequestContext | undefined => storage.getStore();

/**
 * Opens a request context for every HTTP request, the way `@fastify/request-context`
 * does, without the dependency.
 *
 * Body parsing runs on stream events, outside the scope opened in `onRequest`, so
 * `preValidation` enters it again before guards and handlers run.
 */
export function registerRequestContext(fastify: FastifyInstance): void {
  fastify.addHook('onRequest', (request, reply, done) => {
    reply.header('x-request-id', request.id);
    const context: RequestContext = {
      requestId: request.id,
      method: request.method,
      route: request.routeOptions.url,
    };
    storage.run(context, () => {
      const scope = new AsyncResource('lf-request');
      scopes.set(request, scope);
      scope.runInAsyncScope(done);
    });
  });

  fastify.addHook('preValidation', (request, _reply, done) => {
    const scope = scopes.get(request);
    if (scope) scope.runInAsyncScope(done);
    else done();
  });
}
