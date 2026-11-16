import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for personal data the API must read back (the clients' URSSAF
 * dossiers). Output: `v1:<iv>:<tag>:<ciphertext>`, base64 parts. The version prefix
 * leaves room for a key rotation: a `v2` reads with the new key, `v1` with the old.
 *
 * Errors never carry the plaintext; callers log `error.name` only.
 */
const VERSION = 'v1';
const IV_BYTES = 12;
/** Pinned: without it Node accepts a truncated tag (down to 4 bytes) as valid. */
const TAG_BYTES = 16;

export function cipherKey(base64: string | undefined): Buffer {
  const key = Buffer.from(base64 ?? '', 'base64');
  if (key.length !== 32) throw new Error('The cipher key must be 32 bytes of base64.');
  return key;
}

export function seal(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64')))
    .join(':');
}

export function open(sealed: string, key: Buffer): string {
  const [version, iv, tag, ciphertext] = sealed.split(':');
  if (version !== VERSION) throw new Error(`Unknown cipher version ${version}.`);
  const ivBytes = Buffer.from(iv ?? '', 'base64');
  const tagBytes = Buffer.from(tag ?? '', 'base64');
  if (ivBytes.length !== IV_BYTES) throw new Error('Invalid IV length.');
  if (tagBytes.length !== TAG_BYTES)
    throw new Error('Invalid authentication tag length.');
  if (ciphertext === undefined) throw new Error('Missing ciphertext.');
  const decipher = createDecipheriv('aes-256-gcm', key, ivBytes, {
    authTagLength: TAG_BYTES,
  });
  decipher.setAuthTag(tagBytes);
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
