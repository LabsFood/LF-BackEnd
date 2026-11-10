import { parisMinute, parisToday } from '../../../common/paris-time';

/**
 * BLK-33 (2026-11-10): the Lab's Food admin builds the common ingredient list at
 * the start of a season, then is reminded at each new season to review it; it can
 * be edited at any time. Seasons start on the 1st of March, June, September and
 * December, Paris time: the list's seasons are whole months.
 */

export type SeasonCode = 'winter' | 'spring' | 'summer' | 'autumn';

/** The first month (1 to 12) of each season. */
const SEASON_STARTS: ReadonlyArray<[number, SeasonCode]> = [
  [12, 'winter'],
  [9, 'autumn'],
  [6, 'summer'],
  [3, 'spring'],
];

/** The season `now` falls in, and the instant it started. */
export function seasonOf(now: Date): { code: SeasonCode; startsAt: Date } {
  const today = parisToday(now);
  const month = today.getUTCMonth() + 1;
  let year = today.getUTCFullYear();
  let found = SEASON_STARTS.find(([start]) => month >= start);
  if (!found) {
    // January or February: winter began last December.
    found = SEASON_STARTS[0];
    year -= 1;
  }
  const [startMonth, code] = found;
  return { code, startsAt: parisMinute(new Date(Date.UTC(year, startMonth - 1, 1)), 0) };
}

export type SeasonReviewReason = 'empty' | 'never_reviewed' | 'new_season';

/**
 * Whether the console should remind the admin to build or review the list.
 * Derived, never scheduled: no job to run, nothing sent twice by two replicas.
 */
export function seasonReview(now: Date, reviewedAt: Date | null, listSize: number) {
  const season = seasonOf(now);
  const reason: SeasonReviewReason | null =
    listSize === 0
      ? 'empty'
      : !reviewedAt
        ? 'never_reviewed'
        : reviewedAt < season.startsAt
          ? 'new_season'
          : null;
  return {
    season: season.code,
    seasonStartsAt: season.startsAt,
    reviewedAt,
    due: reason !== null,
    reason,
  };
}
