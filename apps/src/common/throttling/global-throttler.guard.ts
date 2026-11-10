import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { ThrottlerRequest } from '@nestjs/throttler';

/**
 * Per-IP ceiling on every HTTP route, registered as `APP_GUARD`. Generous on
 * purpose: it stops enumeration and brute force, while the tight route-level
 * limits (`register`, `payments`) stay where `ThrottlerGuard` is attached.
 *
 * ponytail: in-memory per replica (develop runs 2), so the real ceiling is
 * limit × replicas; move to a Redis storage if that matters.
 */
export const GLOBAL_THROTTLER = { name: 'global', ttl: 60_000, limit: 300 } as const;

@Injectable()
export class GlobalThrottlerGuard extends ThrottlerGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // The messaging WebSocket has its own rate limit and no HTTP response.
    if (context.getType() !== 'http') return true;
    return super.canActivate(context);
  }

  protected async handleRequest(props: ThrottlerRequest): Promise<boolean> {
    if (props.throttler.name !== GLOBAL_THROTTLER.name) return true;
    return super.handleRequest(props);
  }

  // Own counter: a route that also carries the stock ThrottlerGuard must not
  // count each request twice against the global limit.
  protected generateKey(context: ExecutionContext, suffix: string, name: string): string {
    return super.generateKey(context, `${suffix}:global-guard`, name);
  }
}
