import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The OAuth `state` that goes to Cronofy and comes back through the batch
 * cooker's browser: `chefProfileId.expiry.nonce.mac`. Signed, so a code can only
 * be attached to the batch cooker who asked for the link, within 10 minutes.
 */

export const STATE_TTL_MS = 10 * 60 * 1000;

/** Its own key, derived from the token key, so the two uses never share one. */
const macKey = (key: Buffer) =>
  createHmac('sha256', key).update('cronofy-oauth-state').digest();

const mac = (payload: string, key: Buffer) =>
  createHmac('sha256', macKey(key)).update(payload).digest('base64url');

export function signState(chefProfileId: string, key: Buffer, now = Date.now()): string {
  const payload = `${chefProfileId}.${now + STATE_TTL_MS}.${randomBytes(8).toString('hex')}`;
  return `${payload}.${mac(payload, key)}`;
}

export function verifyState(
  state: string,
  chefProfileId: string,
  key: Buffer,
  now = Date.now(),
): boolean {
  const cut = state.lastIndexOf('.');
  if (cut < 0) return false;
  const payload = state.slice(0, cut);
  const given = Buffer.from(state.slice(cut + 1));
  const expected = Buffer.from(mac(payload, key));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  const [owner, expiry] = payload.split('.');
  return owner === chefProfileId && Number(expiry) > now;
}
