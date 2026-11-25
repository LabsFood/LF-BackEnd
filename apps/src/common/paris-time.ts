/**
 * Paris wall-clock time, with `Intl` only. Calendar dates are `Date`s at UTC
 * midnight, as Prisma reads a `DATE` column.
 */

const PARIS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Paris',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const MINUTE_MS = 60_000;
export const DAY_MS = 24 * 60 * MINUTE_MS;

/** How far ahead of UTC Paris is at that instant, in milliseconds. */
export function parisOffsetMs(at: Date): number {
  const part = Object.fromEntries(PARIS.formatToParts(at).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(part.year),
    Number(part.month) - 1,
    Number(part.day),
    Number(part.hour),
    Number(part.minute),
    Number(part.second),
  );
  return asUtc - at.getTime();
}

/**
 * The instant at which a Paris wall clock shows `minute` minutes past midnight on
 * `day`. Two passes, so the hours around a clock change come out right; a time the
 * spring change skips lands an hour later.
 */
export function parisMinute(day: Date, minute: number): Date {
  const wall =
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) +
    minute * MINUTE_MS;
  const guess = wall - parisOffsetMs(new Date(wall));
  return new Date(wall - parisOffsetMs(new Date(guess)));
}

/** The Paris calendar date an instant falls on (today's by default). */
export function parisToday(now: Date = new Date()): Date {
  const local = new Date(now.getTime() + parisOffsetMs(now));
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()),
  );
}

/** 0 for Monday … 6 for Sunday, as the agenda counts them. */
export const weekdayOf = (day: Date) => (day.getUTCDay() + 6) % 7;

/** `YYYY-MM-DD`. */
export const ymd = (day: Date) => day.toISOString().slice(0, 10);

const HHMM = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** `09:30`, Paris time. */
export const parisHhmm = (at: Date) => HHMM.format(at);
