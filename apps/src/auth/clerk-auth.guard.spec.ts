import {
  ExecutionContext,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verifyToken } from '@clerk/backend';

import { ClerkAuthGuard, ClerkUser, shouldVerifyClerkJwt } from './clerk-auth.guard';

jest.mock('@clerk/backend', () => ({
  verifyToken: jest.fn(),
}));

const mockedVerifyToken = verifyToken as jest.MockedFunction<typeof verifyToken>;

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

describe('shouldVerifyClerkJwt', () => {
  it('skips verification in test environment', () => {
    expect(shouldVerifyClerkJwt('sk_test_abc123', 'test')).toBe(false);
  });

  it('skips verification for the local placeholder secret in development', () => {
    expect(shouldVerifyClerkJwt('sk_test_placeholder', 'development')).toBe(false);
  });

  it('enables verification for real Clerk secret keys outside test', () => {
    expect(shouldVerifyClerkJwt('sk_test_abc123', 'development')).toBe(true);
    expect(shouldVerifyClerkJwt('sk_live_abc123', 'production')).toBe(true);
  });

  // Fail closed: a misconfigured key makes every token fail, never every token pass.
  it('verifies the placeholder secret outside development', () => {
    expect(shouldVerifyClerkJwt('sk_test_placeholder', 'production')).toBe(true);
    expect(shouldVerifyClerkJwt('sk_test_placeholder', undefined)).toBe(true);
  });

  it('verifies a malformed secret instead of decoding tokens unchecked', () => {
    expect(shouldVerifyClerkJwt('not-a-clerk-key', 'development')).toBe(true);
    expect(shouldVerifyClerkJwt('not-a-clerk-key', 'production')).toBe(true);
  });
});

describe('ClerkAuthGuard', () => {
  const guardWithConfig = (options: {
    secret?: string;
    environment?: string;
    corsOrigins?: string[];
  }) => {
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'clerk.secretKey') return options.secret;
        if (key === 'environment') return options.environment ?? 'test';
        if (key === 'cors.origins')
          return options.corsOrigins ?? ['http://localhost:3000'];
        return undefined;
      }),
    } as unknown as ConfigService;
    return new ClerkAuthGuard(config);
  };

  beforeEach(() => {
    mockedVerifyToken.mockReset();
  });

  it('throws ServiceUnavailableException when CLERK_SECRET_KEY is missing', async () => {
    const guard = guardWithConfig({ secret: undefined });
    const ctx = buildContext({ headers: {} });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ServiceUnavailableException);
  });

  it('rejects requests missing a Bearer token', async () => {
    const guard = guardWithConfig({ secret: 'sk_test_placeholder' });
    const ctx = buildContext({ headers: {} });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects malformed JWTs', async () => {
    const guard = guardWithConfig({ secret: 'sk_test_placeholder' });
    const ctx = buildContext({ headers: { authorization: 'Bearer not-a-jwt' } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects JWTs without a sub claim', async () => {
    const guard = guardWithConfig({ secret: 'sk_test_placeholder' });
    const ctx = buildContext({
      headers: { authorization: `Bearer ${buildJwt({ email: 'x@y.z' })}` },
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('attaches a ClerkUser when the token has a sub (local decode path)', async () => {
    const guard = guardWithConfig({ secret: 'sk_test_placeholder' });
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
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.clerkUser).toEqual({
      userId: 'user_test_123',
      sessionId: 'sess_1',
      email: 'alice@example.com',
    });
    expect(mockedVerifyToken).not.toHaveBeenCalled();
  });

  it('verifies tokens with @clerk/backend when a real secret is configured', async () => {
    mockedVerifyToken.mockResolvedValue({
      sub: 'user_live_1',
      sid: 'sess_live_1',
    } as Awaited<ReturnType<typeof verifyToken>>);

    const guard = guardWithConfig({
      secret: 'sk_test_realClerkKey1',
      environment: 'development',
    });
    const req: FakeRequest = {
      headers: { authorization: 'Bearer clerk.session.jwt' },
    };
    const ctx = buildContext(req);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(mockedVerifyToken).toHaveBeenCalledWith('clerk.session.jwt', {
      secretKey: 'sk_test_realClerkKey1',
      authorizedParties: ['http://localhost:3000'],
    });
    expect(req.clerkUser).toEqual({
      userId: 'user_live_1',
      sessionId: 'sess_live_1',
      email: undefined,
    });
  });

  it('rejects invalid tokens when strict verification is enabled', async () => {
    mockedVerifyToken.mockRejectedValue(new Error('invalid'));

    const guard = guardWithConfig({
      secret: 'sk_test_realClerkKey1',
      environment: 'production',
    });
    const ctx = buildContext({
      headers: { authorization: 'Bearer bad.token.here' },
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(
      new UnauthorizedException('Invalid or expired Clerk token.'),
    );
  });
});
