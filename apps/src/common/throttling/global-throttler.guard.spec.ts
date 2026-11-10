import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerException, ThrottlerStorage } from '@nestjs/throttler';

import { GLOBAL_THROTTLER, GlobalThrottlerGuard } from './global-throttler.guard';

class Controller {
  handler(): void {}
}

const httpContext = (ip = '203.0.113.7'): ExecutionContext =>
  ({
    getType: () => 'http',
    getClass: () => Controller,
    getHandler: () => Controller.prototype.handler,
    switchToHttp: () => ({
      getRequest: () => ({ ip, headers: {} }),
      getResponse: () => ({ header: jest.fn() }),
    }),
  }) as unknown as ExecutionContext;

const build = (limit: number) => {
  const hits = new Map<string, number>();
  const storage: ThrottlerStorage = {
    increment: jest.fn(async (key: string, ttl: number, max: number) => {
      const totalHits = (hits.get(key) ?? 0) + 1;
      hits.set(key, totalHits);
      const isBlocked = totalHits > max;
      return {
        totalHits,
        timeToExpire: ttl,
        isBlocked,
        timeToBlockExpire: isBlocked ? ttl : 0,
      };
    }),
  };
  const guard = new GlobalThrottlerGuard(
    {
      throttlers: [
        { ...GLOBAL_THROTTLER, limit },
        { name: 'register', ttl: 3_600_000, limit: 1 },
      ],
    },
    storage,
    new Reflector(),
  );
  return { guard, storage };
};

describe('GlobalThrottlerGuard', () => {
  it('lets through what the global limit allows and refuses the next request', async () => {
    const { guard } = build(2);
    await guard.onModuleInit();
    await expect(guard.canActivate(httpContext())).resolves.toBe(true);
    await expect(guard.canActivate(httpContext())).resolves.toBe(true);
    await expect(guard.canActivate(httpContext())).rejects.toThrow(ThrottlerException);
  });

  it('counts each client IP apart', async () => {
    const { guard } = build(1);
    await guard.onModuleInit();
    await expect(guard.canActivate(httpContext('203.0.113.1'))).resolves.toBe(true);
    await expect(guard.canActivate(httpContext('203.0.113.2'))).resolves.toBe(true);
  });

  // The route-level throttlers (register 5/h, payments 20/min) stay opt-in:
  // applied everywhere they would lock users out of the whole API.
  it('ignores the named route-level throttlers', async () => {
    const { guard, storage } = build(100);
    await guard.onModuleInit();
    await guard.canActivate(httpContext());
    await guard.canActivate(httpContext());
    const names = (storage.increment as jest.Mock).mock.calls.map((call) => call[4]);
    expect(names).toEqual([GLOBAL_THROTTLER.name, GLOBAL_THROTTLER.name]);
  });

  it('leaves the messaging WebSocket alone', async () => {
    const { guard, storage } = build(1);
    await guard.onModuleInit();
    const ws = { getType: () => 'ws' } as unknown as ExecutionContext;
    await expect(guard.canActivate(ws)).resolves.toBe(true);
    expect(storage.increment).not.toHaveBeenCalled();
  });
});
