import { randomBytes } from 'node:crypto';

import { cipherKey, open, seal } from './field-cipher';

const KEY = randomBytes(32);

describe('field-cipher', () => {
  it('round-trips, with a fresh IV each time', () => {
    const a = seal('FR7630006000011234567890189', KEY);
    const b = seal('FR7630006000011234567890189', KEY);
    expect(a).not.toEqual(b);
    expect(a.startsWith('v1:')).toBe(true);
    expect(open(a, KEY)).toBe('FR7630006000011234567890189');
  });

  it('never shows the plaintext', () => {
    expect(seal('secret-iban', KEY)).not.toContain('secret-iban');
  });

  it('refuses a tampered payload', () => {
    const sealed = seal('hello', KEY);
    const parts = sealed.split(':');
    const ct = Buffer.from(parts[3], 'base64');
    ct[0] ^= 1;
    parts[3] = ct.toString('base64');
    expect(() => open(parts.join(':'), KEY)).toThrow();
  });

  it('refuses the wrong key', () => {
    expect(() => open(seal('hello', KEY), randomBytes(32))).toThrow();
  });

  it('refuses an unknown version', () => {
    expect(() => open(seal('hello', KEY).replace(/^v1:/, 'v9:'), KEY)).toThrow(/version/);
  });

  it('loads a 32-byte base64 key and refuses anything else', () => {
    expect(cipherKey(KEY.toString('base64'))).toEqual(KEY);
    expect(() => cipherKey(randomBytes(16).toString('base64'))).toThrow();
    expect(() => cipherKey(undefined)).toThrow();
  });
});
