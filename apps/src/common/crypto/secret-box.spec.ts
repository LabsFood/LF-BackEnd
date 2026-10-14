import { randomBytes } from 'node:crypto';

import { open, seal } from './secret-box';

describe('secret box', () => {
  const key = randomBytes(32);

  it('opens what it sealed, and never stores it in clear', () => {
    const sealed = seal('refresh-token-123', key);

    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain('refresh-token-123');
    expect(open(sealed, key)).toBe('refresh-token-123');
  });

  it('seals the same value differently each time', () => {
    expect(seal('same', key)).not.toBe(seal('same', key));
  });

  it('refuses a value altered since', () => {
    const [version, iv, tag, body] = seal('refresh-token-123', key).split('.');
    const flipped = Buffer.from(body, 'base64url');
    flipped[0] ^= 1;

    expect(() =>
      open([version, iv, tag, flipped.toString('base64url')].join('.'), key),
    ).toThrow();
  });

  it('refuses another key, and anything not sealed', () => {
    expect(() => open(seal('x', key), randomBytes(32))).toThrow();
    expect(() => open('plain-token', key)).toThrow('Not a sealed value.');
  });
});
