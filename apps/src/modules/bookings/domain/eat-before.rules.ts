import { DAY_MS, parisToday, ymd } from '../../../common/paris-time';

/**
 * Recettes lot 3 (LF-0270, LF-0271): the « à manger avant » date of each dish of a
 * prestation. The platform proposes it, the batch cooker may set their own until
 * 24 hours after the prestation ends (decision of 13/11), and each change is kept.
 */

/** The chef sets a date until this long after the prestation ends. */
export const EAT_BEFORE_EDIT_HOURS = 24;

/** A date set by hand stays within a year of the prestation. */
export const EAT_BEFORE_MAX_DAYS = 366;

/** The fridge alert's default, until an admin sets one (BLK-31 still open). */
export const DEFAULT_FRIDGE_ALERT_DAYS = 4;

/** The Paris calendar day the dishes are cooked on. */
export const sessionDay = (startsAt: Date): Date => parisToday(startsAt);

const plusDays = (day: Date, days: number) => new Date(day.getTime() + days * DAY_MS);

/** `storage.days` of the pinned recipe: the days the dish keeps in the fridge. */
export function fridgeDaysOf(storage: unknown): number | null {
  const days = (storage as { days?: unknown } | null)?.days;
  return typeof days === 'number' && Number.isInteger(days) && days >= 0 ? days : null;
}

/** What the platform proposes: the prestation's day plus the fridge days. */
export function proposedEatBefore(startsAt: Date, storage: unknown): Date | null {
  const days = fridgeDaysOf(storage);
  return days === null ? null : plusDays(sessionDay(startsAt), days);
}

/** True while the chef may still set a date: until 24 hours after the end. */
export const eatBeforeOpen = (endsAt: Date, now: Date = new Date()): boolean =>
  now.getTime() < endsAt.getTime() + EAT_BEFORE_EDIT_HOURS * 3_600_000;

/** Why a date the chef sends is refused, or null when it is fine. */
export function eatBeforeRefusal(startsAt: Date, date: Date): string | null {
  const first = sessionDay(startsAt);
  if (date.getTime() < first.getTime()) {
    return 'The date cannot be before the day the dishes are cooked.';
  }
  if (date.getTime() > plusDays(first, EAT_BEFORE_MAX_DAYS).getTime()) {
    return `The date must be within ${EAT_BEFORE_MAX_DAYS} days of the prestation.`;
  }
  return null;
}

/**
 * One dish's date as every screen shows it: the chef's date when set, else the
 * proposed one; how many days in the fridge that makes; and the alert past the
 * threshold (an alert, never a block).
 */
export function eatBeforeView(
  startsAt: Date,
  storage: unknown,
  set: { eatBefore: Date | null; eatBeforeSetAt: Date | null },
  alertDays: number,
) {
  const proposed = proposedEatBefore(startsAt, storage);
  const date = set.eatBefore ?? proposed;
  const fridgeDays =
    date === null
      ? null
      : Math.round((date.getTime() - sessionDay(startsAt).getTime()) / DAY_MS);
  return {
    date: date ? ymd(date) : null,
    proposed: proposed ? ymd(proposed) : null,
    setByChef: set.eatBefore !== null,
    setAt: set.eatBeforeSetAt,
    fridgeDays,
    fridgeAlert: fridgeDays !== null && fridgeDays > alertDays,
  };
}
