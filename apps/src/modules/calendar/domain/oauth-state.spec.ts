import { randomBytes } from 'node:crypto';

import { STATE_TTL_MS, signState, verifyState } from './oauth-state';

describe('OAuth state', () => {
  const key = randomBytes(32);
  const now = Date.UTC(2026, 9, 14, 12);

  it('comes back valid for the batch cooker who asked, within 10 minutes', () => {
    const state = signState('chef-1', key, now);

    expect(verifyState(state, 'chef-1', key, now + STATE_TTL_MS - 1)).toBe(true);
  });

  it('is refused once expired', () => {
    expect(
      verifyState(signState('chef-1', key, now), 'chef-1', key, now + STATE_TTL_MS),
    ).toBe(false);
  });

  it('is refused for another batch cooker', () => {
    expect(verifyState(signState('chef-1', key, now), 'chef-2', key, now)).toBe(false);
  });

  it('is refused when tampered with, or signed with another key', () => {
    const state = signState('chef-1', key, now);
    const longer = state.replace(
      `.${now + STATE_TTL_MS}.`,
      `.${now + 10 * STATE_TTL_MS}.`,
    );

    expect(verifyState(longer, 'chef-1', key, now)).toBe(false);
    expect(verifyState(state, 'chef-1', randomBytes(32), now)).toBe(false);
    expect(verifyState('garbage', 'chef-1', key, now)).toBe(false);
  });
});
