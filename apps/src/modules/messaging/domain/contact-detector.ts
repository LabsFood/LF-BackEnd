/**
 * Phone numbers and email addresses in a message.
 *
 * Deterrence, not a guarantee: a number spoken in a made-up way or an address
 * obfuscated beyond the usual forms still gets through. That is why a detection
 * also flags the thread for an admin instead of being the only safeguard.
 *
 * Covered: digits, French (and a few English) number words, any mix of the two,
 * emails with "arobase" / "(at)" / "point", and a number split over several
 * messages (`detectSplitContact`).
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

/** "sophie arobase gmail point com", "sophie (at) gmail (dot) com". */
const SPELLED_EMAIL =
  /[\p{L}\d._+-]+\s*(?:\(\s*at\s*\)|\[\s*at\s*\]|\barr?ob(?:ase|aze)\b)\s*[\p{L}\d-]+(?:\s*(?:\(\s*dot\s*\)|\[\s*dot\s*\]|\bpoint\b|\bdot\b|\.)\s*[\p{L}\d-]+)*/giu;

/** A mail provider's domain on its own ("gmail point com") gives the address away. */
const PROVIDER =
  /\b(?:gmail|hotmail|yahoo|outlook|icloud|live|msn|laposte|protonmail|orange|free|sfr|wanadoo)\s*(?:\.|point|dot)\s*(?:com|fr|net|org)\b/giu;

// ── Numbers written in words ────────────────────────────────────────────────

const NUMBER_WORDS =
  'z[eé]ro|une?|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|' +
  'vingts?|trente|quarante|cinquante|soixante|cent|mille|one|two|three|four|five|seven|eight|nine';
const SEP = '[\\s.,\\-()]';
const EDGE = '(?![\\p{L}\\d])';
const NUM = `(?:\\d+|${NUMBER_WORDS})${EDGE}`;
/** A run of digits and number words: "zéro six, 12 34 trente-quatre". */
const RUN = `(?<![\\p{L}\\d])${NUM}(?:${SEP}+(?:et${SEP}+)?${NUM})*`;

const RUN_ANYWHERE = new RegExp(RUN, 'giu');
const WHOLE_RUN = new RegExp(`^\\s*${RUN}\\s*$`, 'iu');
const HEAD_RUN = new RegExp(`^\\s*${RUN}`, 'iu');
const TAIL_RUN = new RegExp(`${RUN}\\s*$`, 'iu');

const TENS = /^(?:vingts?|trente|quarante|cinquante|soixante)$/;
const TEENS = /^(?:dix|onze|douze|treize|quatorze|quinze|seize)$/;

/** How many digits a run says: "trente-quatre" is 2, "soixante-dix-huit" is 2. */
function digitCount(run: string): number {
  const parts = run
    .trim()
    .toLowerCase()
    .split(/([\s.,\-()]+)/);
  let total = 0;
  let compound = false; // inside "trente-quatre", "quatre-vingt-dix-sept", "vingt et un"
  let prev = '';
  for (let i = 0; i < parts.length; i += 2) {
    const word = parts[i];
    const sep = parts[i - 1] ?? '';
    if (word === 'et') {
      prev = word;
      continue;
    }
    if (sep !== '-' && prev !== 'et') compound = false;
    if (/^\d+$/.test(word)) total += word.length;
    else if (TENS.test(word)) {
      total += prev === 'quatre' && sep === '-' ? 1 : 2; // "quatre" already counted 1
      compound = true;
    } else if (!compound) total += TEENS.test(word) ? 2 : 1;
    prev = word;
  }
  return total;
}

const PHONE_DIGITS = 9;

function hasNumberRun(text: string, min: number): boolean {
  return [...text.matchAll(RUN_ANYWHERE)].some((m) => digitCount(m[0]) >= min);
}

export function detectContact(text: string): boolean {
  return (
    matches(PHONE, text) ||
    matches(EMAIL, text) ||
    matches(SPELLED_EMAIL, text) ||
    matches(PROVIDER, text) ||
    hasNumberRun(text, PHONE_DIGITS)
  );
}

/**
 * `fragment`: the message is part of a number split over several messages, so any
 * digit or number word in it is hidden, however short the run.
 */
export function maskContact(text: string, fragment = false): string {
  return text
    .replace(SPELLED_EMAIL, CONTACT_MASK)
    .replace(EMAIL, CONTACT_MASK)
    .replace(PROVIDER, CONTACT_MASK)
    .replace(PHONE, CONTACT_MASK)
    .replace(RUN_ANYWHERE, (run) =>
      digitCount(run) >= (fragment ? 1 : PHONE_DIGITS) ? CONTACT_MASK : run,
    );
}

/**
 * A number sent in pieces ("0", "6", "1"… one message each). `previous` is the
 * sender's own recent messages, oldest first. Returns how many of the newest ones
 * form a phone number together with `body` (0 if none): the caller flags those too.
 * Only messages made of digits and number words chain, so ordinary chat in between
 * breaks the sequence.
 */
export function detectSplitContact(previous: string[], body: string): number {
  const head = body.match(HEAD_RUN)?.[0];
  if (!head) return 0;

  const parts: string[] = []; // newest first
  for (let i = previous.length - 1; i >= 0; i--) {
    if (WHOLE_RUN.test(previous[i])) {
      parts.push(previous[i].trim());
      continue;
    }
    const tail = previous[i].match(TAIL_RUN)?.[0];
    if (tail) parts.push(tail.trim());
    break;
  }

  const chain = [head.trim()];
  for (let n = 0; n < parts.length; n++) {
    chain.unshift(parts[n]);
    if (digitCount(chain.join(' ')) >= PHONE_DIGITS) return n + 1;
  }
  return 0;
}

/** `RegExp.test` on a global pattern keeps a cursor between calls; this does not. */
function matches(pattern: RegExp, text: string): boolean {
  pattern.lastIndex = 0;
  const found = pattern.test(text);
  pattern.lastIndex = 0;
  return found;
}
