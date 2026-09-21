import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Access credential for a candidate who has no account yet (FLOW-01 §4).
 *
 * FLOW-01 describes a JWT, but it also requires the credential to be *revoked at
 * the decision*. A JWT cannot be revoked without a server-side blocklist, which is
 * a session table in disguise. An opaque random token stored as a hash satisfies
 * every stated property — 30 days, scoped to one candidature, carried in a link
 * then as a Bearer token — and revokes by nulling a column.
 *
 * Only the hash is persisted, so a database leak does not hand out valid links.
 */

export const APPLICATION_TOKEN_TTL_DAYS = 30;

/** Resends allowed per rolling 24 h window (FLOW-01 §4). */
export const RESEND_LIMIT_PER_DAY = 3;

export interface MintedToken {
  /** Sent to the candidate. Never stored. */
  token: string;
  /** Stored on the candidature. */
  tokenHash: string;
  expiresAt: Date;
}

export function hashApplicationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function mintApplicationToken(now: Date = new Date()): MintedToken {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + APPLICATION_TOKEN_TTL_DAYS);
  return { token, tokenHash: hashApplicationToken(token), expiresAt };
}

/** Constant-time comparison, so a wrong token leaks nothing through timing. */
export function tokenMatches(token: string, storedHash: string | null): boolean {
  if (!storedHash) return false;
  const candidate = Buffer.from(hashApplicationToken(token), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

export function isExpired(expiresAt: Date | null, now: Date = new Date()): boolean {
  return !expiresAt || expiresAt.getTime() <= now.getTime();
}

/**
 * Rolling 24 h resend window. Returns the next counter state, or `null` when the
 * candidate has already used their three sends.
 */
export function nextResendState(
  current: { resendCount: number; resendWindowStartedAt: Date | null },
  now: Date = new Date(),
): { resendCount: number; resendWindowStartedAt: Date } | null {
  const windowStart = current.resendWindowStartedAt;
  const windowOpen =
    windowStart !== null && now.getTime() - windowStart.getTime() < 24 * 60 * 60 * 1000;

  if (!windowOpen) return { resendCount: 1, resendWindowStartedAt: now };
  if (current.resendCount >= RESEND_LIMIT_PER_DAY) return null;
  return { resendCount: current.resendCount + 1, resendWindowStartedAt: windowStart! };
}
