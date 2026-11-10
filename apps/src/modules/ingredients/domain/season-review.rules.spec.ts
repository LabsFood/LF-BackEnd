import { seasonOf, seasonReview } from './season-review.rules';

// Paris is UTC+1 in winter, UTC+2 in summer.
const at = (iso: string) => new Date(iso);

describe('seasonOf (BLK-33)', () => {
  it('starts each season on the 1st of March, June, September and December, Paris time', () => {
    expect(seasonOf(at('2026-11-10T10:00:00Z'))).toEqual({
      code: 'autumn',
      startsAt: at('2026-08-31T22:00:00Z'),
    });
    expect(seasonOf(at('2026-12-01T09:00:00Z'))).toEqual({
      code: 'winter',
      startsAt: at('2026-11-30T23:00:00Z'),
    });
  });

  it('keeps winter across the new year', () => {
    expect(seasonOf(at('2027-02-28T12:00:00Z'))).toEqual({
      code: 'winter',
      startsAt: at('2026-11-30T23:00:00Z'),
    });
  });

  it('switches at Paris midnight, not UTC midnight', () => {
    // 23:30 UTC on 28 Feb is already 1 March in Paris.
    expect(seasonOf(at('2027-02-28T23:30:00Z')).code).toBe('spring');
    expect(seasonOf(at('2027-02-28T22:30:00Z')).code).toBe('winter');
  });
});

describe('seasonReview (BLK-33)', () => {
  const now = at('2026-11-10T10:00:00Z');

  it('asks for the first list while the common list is empty', () => {
    expect(seasonReview(now, null, 0)).toMatchObject({ due: true, reason: 'empty' });
  });

  it('asks for a review when the list was never reviewed', () => {
    expect(seasonReview(now, null, 12)).toMatchObject({
      due: true,
      reason: 'never_reviewed',
    });
  });

  it('asks again once a new season started after the last review', () => {
    expect(seasonReview(now, at('2026-08-15T08:00:00Z'), 12)).toMatchObject({
      due: true,
      reason: 'new_season',
      season: 'autumn',
    });
  });

  it('says nothing once the list was reviewed this season', () => {
    expect(seasonReview(now, at('2026-09-02T08:00:00Z'), 12)).toEqual({
      season: 'autumn',
      seasonStartsAt: at('2026-08-31T22:00:00Z'),
      reviewedAt: at('2026-09-02T08:00:00Z'),
      due: false,
      reason: null,
    });
  });
});
