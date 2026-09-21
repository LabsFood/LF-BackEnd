import {
  APPLICATION_TOKEN_TTL_DAYS,
  hashApplicationToken,
  isExpired,
  mintApplicationToken,
  nextResendState,
  RESEND_LIMIT_PER_DAY,
  tokenMatches,
} from './application-token';

describe('mintApplicationToken', () => {
  it('never returns the same token twice', () => {
    const tokens = new Set(
      Array.from({ length: 200 }, () => mintApplicationToken().token),
    );
    expect(tokens.size).toBe(200);
  });

  it('stores only a hash, never the token itself', () => {
    const { token, tokenHash } = mintApplicationToken();
    expect(tokenHash).not.toContain(token);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(hashApplicationToken(token));
  });

  it('expires 30 days out', () => {
    const now = new Date('2026-09-20T09:00:00.000Z');
    const { expiresAt } = mintApplicationToken(now);
    const days = (expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBe(APPLICATION_TOKEN_TTL_DAYS);
  });
});

describe('tokenMatches', () => {
  it('accepts the token it was minted from', () => {
    const { token, tokenHash } = mintApplicationToken();
    expect(tokenMatches(token, tokenHash)).toBe(true);
  });

  it('rejects a different token', () => {
    const { tokenHash } = mintApplicationToken();
    expect(tokenMatches(mintApplicationToken().token, tokenHash)).toBe(false);
  });

  it('rejects everything once the hash is nulled — this is what revocation is', () => {
    const { token } = mintApplicationToken();
    expect(tokenMatches(token, null)).toBe(false);
  });

  it('does not throw on a malformed stored hash', () => {
    const { token } = mintApplicationToken();
    expect(tokenMatches(token, 'not-a-hash')).toBe(false);
  });
});

describe('isExpired', () => {
  const now = new Date('2026-09-20T12:00:00.000Z');

  it('treats a missing expiry as expired rather than eternal', () => {
    expect(isExpired(null, now)).toBe(true);
  });

  it('is expired at the exact boundary', () => {
    expect(isExpired(new Date(now), now)).toBe(true);
  });

  it('is live one second before', () => {
    expect(isExpired(new Date(now.getTime() + 1000), now)).toBe(false);
  });
});

describe('nextResendState (3 per rolling 24 h)', () => {
  const now = new Date('2026-09-20T12:00:00.000Z');

  it('opens a window on the first send', () => {
    expect(nextResendState({ resendCount: 0, resendWindowStartedAt: null }, now)).toEqual(
      {
        resendCount: 1,
        resendWindowStartedAt: now,
      },
    );
  });

  it('counts up inside the window without moving its start', () => {
    const start = new Date(now.getTime() - 60 * 60 * 1000);
    expect(
      nextResendState({ resendCount: 1, resendWindowStartedAt: start }, now),
    ).toEqual({
      resendCount: 2,
      resendWindowStartedAt: start,
    });
  });

  it(`refuses the send after ${RESEND_LIMIT_PER_DAY} in the window`, () => {
    const start = new Date(now.getTime() - 60 * 60 * 1000);
    expect(
      nextResendState(
        { resendCount: RESEND_LIMIT_PER_DAY, resendWindowStartedAt: start },
        now,
      ),
    ).toBeNull();
  });

  it('opens a fresh window once 24 h have passed, even at the cap', () => {
    const start = new Date(now.getTime() - 24 * 60 * 60 * 1000 - 1);
    expect(
      nextResendState(
        { resendCount: RESEND_LIMIT_PER_DAY, resendWindowStartedAt: start },
        now,
      ),
    ).toEqual({ resendCount: 1, resendWindowStartedAt: now });
  });

  it('still refuses one millisecond before the window rolls over', () => {
    const start = new Date(now.getTime() - 24 * 60 * 60 * 1000 + 1);
    expect(
      nextResendState(
        { resendCount: RESEND_LIMIT_PER_DAY, resendWindowStartedAt: start },
        now,
      ),
    ).toBeNull();
  });
});
