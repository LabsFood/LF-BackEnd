import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Secrets kept in the database (the Cronofy tokens) are sealed with AES-256-GCM:
 * unreadable without the key, and refused if anyone changed a byte. Stored as
 * `v1.<iv>.<tag>.<ciphertext>`, base64url; the version lets the key or the
 * algorithm change later without guessing what an old row holds.
 */

const VERSION = 'v1';

export function seal(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), body]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

/** Throws on a value sealed with another key, or altered since. */
export function open(sealed: string, key: Buffer): string {
  const [version, iv, tag, body] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || body === undefined) {
    throw new Error('Not a sealed value.');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(body, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
