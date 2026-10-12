/**
 * Phone numbers and email addresses in a message.
 *
 * Deterrence, not a guarantee: "zéro six douze…" or an address spelled out gets
 * through. That is why a detection also flags the thread for an admin instead of
 * being the only safeguard.
 */

/** What a participant reads in place of the contact detail. */
export const CONTACT_MASK = '•••••';

/**
 * Nine digits or more, optionally split by the separators people type. Nine keeps
 * French numbers (10 digits, or 9 after +33) and leaves booking references
 * (`LF-2026-0142`, 8 digits), prices, dates and quantities alone.
 */
const PHONE = /(?:\+|00)?\d(?:[\s.\-()]{0,3}\d){8,}/g;

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

export function detectContact(text: string): boolean {
  return matches(PHONE, text) || matches(EMAIL, text);
}

export function maskContact(text: string): string {
  return text.replace(EMAIL, CONTACT_MASK).replace(PHONE, CONTACT_MASK);
}

/** `RegExp.test` on a global pattern keeps a cursor between calls; this does not. */
function matches(pattern: RegExp, text: string): boolean {
  pattern.lastIndex = 0;
  const found = pattern.test(text);
  pattern.lastIndex = 0;
  return found;
}
