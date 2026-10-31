import { verifyToken } from '@clerk/backend';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { currentRequest } from '../common/logging/request-context';

export interface ClerkUser {
  userId: string;
  sessionId?: string;
  email?: string;
}

interface JwtClaims {
  sub?: string;
  sid?: string;
  email?: string;
  [key: string]: unknown;
}

/** Local placeholder from AGENTS.md — skips JWKS verification. */
// nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret -- public placeholder, not a key
const CLERK_LOCAL_STUB_SECRET = 'sk_test_placeholder';

/** Real Clerk secret keys enable strict JWT verification. Also enforced by env.validation.ts in production. */
export const CLERK_SECRET_KEY_PATTERN = /^sk_(test|live)_[a-zA-Z0-9]+$/;

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      clerkUser?: ClerkUser;
    }>();

    assertClerkConfigured(this.config);

    const header = req.headers['authorization'];
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header.');
    }

    req.clerkUser = await resolveClerkUser(header.slice(7).trim(), this.config);
    const request = currentRequest();
    if (request) request.userId = req.clerkUser.userId;
    return true;
  }
}

function assertClerkConfigured(config: ConfigService): string {
  const secret = config.get<string>('clerk.secretKey');
  if (!secret) {
    throw new ServiceUnavailableException(
      'Clerk is not configured (CLERK_SECRET_KEY missing).',
    );
  }
  return secret;
}

/**
 * Turns a Clerk session token into the caller's identity, or throws.
 *
 * Outside the guard so that a transport with no `Authorization` header, the
 * messaging WebSocket, checks a token exactly as an HTTP route does.
 */
export async function resolveClerkUser(
  token: string,
  config: ConfigService,
): Promise<ClerkUser> {
  const secret = assertClerkConfigured(config);
  const claims = await resolveClaims(token, secret, config);
  if (!claims?.sub) {
    throw new UnauthorizedException('Token missing subject claim.');
  }

  return {
    userId: claims.sub,
    sessionId: claims.sid,
    email: typeof claims.email === 'string' ? claims.email : undefined,
  };
}

async function resolveClaims(
  token: string,
  secret: string,
  config: ConfigService,
): Promise<JwtClaims | null> {
  if (shouldVerifyClerkJwt(secret, config.get<string>('environment'))) {
    try {
      const payload = await verifyToken(token, {
        secretKey: secret,
        authorizedParties: config.get<string[]>('cors.origins'),
      });
      return payload as JwtClaims;
    } catch {
      throw new UnauthorizedException('Invalid or expired Clerk token.');
    }
  }

  return decodeUnverifiedJwt(token);
}

export function shouldVerifyClerkJwt(secret: string, environment?: string): boolean {
  if (environment === 'test') return false;
  if (secret === CLERK_LOCAL_STUB_SECRET) return false;
  return CLERK_SECRET_KEY_PATTERN.test(secret);
}

/** Decode a JWT payload without verifying the signature (local / test only). */
function decodeUnverifiedJwt(token: string): JwtClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(json) as JwtClaims;
  } catch {
    return null;
  }
}
