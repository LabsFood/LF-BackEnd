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

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
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
    const claims = decodeUnverifiedJwt(token);
    if (!claims?.sub) {
      throw new UnauthorizedException('Token missing subject claim.');
    }

    req.clerkUser = {
      userId: claims.sub,
      sessionId: claims.sid,
      email: claims.email,
    };
    return true;
  }
}

/** Decode a JWT payload without verifying the signature.
 *
 *  Phase 1 stub matching the FastAPI `jose.jwt.get_unverified_claims()` behaviour.
 *  Replace with full JWKS verification once the Clerk instance URL is provisioned.
 */
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
