import { createHash } from 'node:crypto';

/**
 * Pure rules behind the public weekly page (FLOW-02 §5.1) and the PRD's ordering
 * decisions. No I/O: dates come in, orders and filters come out.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Today in France, `YYYY-MM-DD`: a week starts on a French Monday, not a UTC one. */
export function parisDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(now);
}

const parisClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Paris',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * The instant a Paris day begins: 22:00 or 23:00 UTC the day before, depending on
 * summer time. Timestamps (slots) are compared against this, not UTC midnight.
 * France changes time at 02:00 or 03:00 on a Sunday, so the offset read at UTC
 * midnight of any other day is that day's.
 */
export function parisMidnight(day: string): Date {
  const utcMidnight = new Date(`${day}T00:00:00Z`);
  const [hours, minutes] = parisClock.format(utcMidnight).split(':').map(Number);
  return new Date(utcMidnight.getTime() - (hours * 60 + minutes) * 60 * 1000);
}

/** The Monday on or before `day` (`YYYY-MM-DD`), and the Sunday after it. */
export function weekOf(day: string): { start: string; end: string } {
  const date = new Date(`${day}T00:00:00Z`);
  const sinceMonday = (date.getUTCDay() + 6) % 7;
  const start = new Date(date.getTime() - sinceMonday * DAY_MS);
  const end = new Date(start.getTime() + 6 * DAY_MS);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/** One entry of `chef_profiles.intervention_zones`, as FLOW-01 stores it. */
export interface InterventionZone {
  regionCode: string;
  scope: 'region' | 'cities';
  cities?: { insee: string }[];
}

/**
 * Whether a chef's zones cover the requested area. A `city` is covered when a zone
 * lists it, or when a whole-region zone matches the `region` sent with it: the API
 * does not know which region a town belongs to, so the page sends both.
 */
export function coversArea(
  zones: InterventionZone[],
  area: { region?: string; city?: string },
): boolean {
  if (!area.region && !area.city) return true;
  return zones.some((zone) => {
    if (area.region && zone.regionCode !== area.region) return false;
    if (!area.city) return true;
    if (zone.scope === 'region') return Boolean(area.region);
    return (zone.cities ?? []).some((city) => city.insee === area.city);
  });
}

/**
 * The diets **every** dish of a menu satisfies (§5.1): a "gluten-free" menu only
 * means something if each dish is. An empty menu covers nothing.
 */
export function coveredDiets(dishes: { diets: string[] }[]): string[] {
  if (dishes.length === 0) return [];
  const [first, ...rest] = dishes;
  return first.diets.filter((diet) => rest.every((dish) => dish.diets.includes(diet)));
}

/**
 * The PRD's rotation: one order per calendar month, the same for every visitor,
 * so exposure is shared out month by month instead of going to whoever arrived
 * first. A hash of the chef id and the month; stable within the month, so
 * pagination does not reshuffle between pages.
 */
export function rotationKey(chefId: string, day: string): string {
  return createHash('sha256')
    .update(`${chefId}:${day.slice(0, 7)}`)
    .digest('hex');
}

/** Chefs with a menu this week first, each group in the month's rotation (PRD §9.7). */
export function vitrineOrder<T extends { chefId: string; hasMenu: boolean }>(
  cards: T[],
  day: string,
): T[] {
  return [...cards].sort(
    (a, b) =>
      Number(b.hasMenu) - Number(a.hasMenu) ||
      rotationKey(a.chefId, day).localeCompare(rotationKey(b.chefId, day)),
  );
}
