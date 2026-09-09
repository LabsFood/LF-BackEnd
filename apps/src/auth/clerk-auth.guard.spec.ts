import {
  ExecutionContext,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ClerkAuthGuard, ClerkUser } from './clerk-auth.guard';

interface FakeRequest {
  headers: Record<string, string | undefined>;
  clerkUser?: ClerkUser;
}

const buildContext = (req: FakeRequest): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: <T>() => req as unknown as T }),
  }) as unknown as ExecutionContext;

const buildJwt = (claims: Record<string, unknown>): string => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
    'base64url',
  );
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.signature`;
};

describe('ClerkAuthGuard', () => {
  const guardWithSecret = (secret: string | undefined) => {
    const config = {
      get: jest.fn().mockReturnValue(secret),
    } as unknown as ConfigService;
    return new ClerkAuthGuard(config);
  };

  it('throws ServiceUnavailableException when CLERK_SECRET_KEY is missing', () => {
    const guard = guardWithSecret(undefined);
    const ctx = buildContext({ headers: {} });
    expect(() => guard.canActivate(ctx)).toThrow(ServiceUnavailableException);
  });

  it('rejects requests missing a Bearer token', () => {
    const guard = guardWithSecret('sk_test_anything');
    const ctx = buildContext({ headers: {} });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects malformed JWTs', () => {
    const guard = guardWithSecret('sk_test_anything');
    const ctx = buildContext({ headers: { authorization: 'Bearer not-a-jwt' } });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects JWTs without a sub claim', () => {
    const guard = guardWithSecret('sk_test_anything');
    const ctx = buildContext({
      headers: { authorization: `Bearer ${buildJwt({ email: 'x@y.z' })}` },
    });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('attaches a ClerkUser when the token has a sub', () => {
    const guard = guardWithSecret('sk_test_anything');
    const req: FakeRequest = {
      headers: {
        authorization: `Bearer ${buildJwt({
          sub: 'user_test_123',
          sid: 'sess_1',
          email: 'alice@example.com',
        })}`,
      },
    };
    const ctx = buildContext(req);
    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.clerkUser).toEqual({
      userId: 'user_test_123',
      sessionId: 'sess_1',
      email: 'alice@example.com',
    });
  });
});
