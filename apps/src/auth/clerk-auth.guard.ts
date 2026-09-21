import { verifyToken } from '@clerk/backend';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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

    const secret = this.config.get<string>('clerk.secretKey');
    if (!secret) {
      throw new ServiceUnavailableException(
        'Clerk is not configured (CLERK_SECRET_KEY missing).',
      );
    }

    const header = req.headers['authorization'];
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header.');
    }

    const token = header.slice(7).trim();
    const claims = await this.resolveClaims(token, secret);
    if (!claims?.sub) {
      throw new UnauthorizedException('Token missing subject claim.');
    }

    req.clerkUser = {
      userId: claims.sub,
      sessionId: claims.sid,
      email: typeof claims.email === 'string' ? claims.email : undefined,
    };
    return true;
  }

  private async resolveClaims(token: string, secret: string): Promise<JwtClaims | null> {
    if (shouldVerifyClerkJwt(secret, this.config.get<string>('environment'))) {
      try {
        const payload = await verifyToken(token, {
          secretKey: secret,
          authorizedParties: this.config.get<string[]>('cors.origins'),
        });
        return payload as JwtClaims;
      } catch {
        throw new UnauthorizedException('Invalid or expired Clerk token.');
      }
    }

    return decodeUnverifiedJwt(token);
  }
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
