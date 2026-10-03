import {
  isValidReason,
  nextReviewReason,
  recurringValues,
  reviewFields,
  reviewFlags,
} from './moderation.rules';

describe('nextReviewReason (§4.1)', () => {
  const fresh = { reviewReason: null, reviewedAt: null };
  const reviewed = { reviewReason: null, reviewedAt: new Date() };

  it('queues a first publication as never reviewed, and nothing for a reviewed one', () => {
    expect(nextReviewReason(fresh, 'published')).toBe('never-reviewed');
    expect(nextReviewReason(reviewed, 'published')).toBeNull();
  });

  it('queues a safety edit after review as edited-after-review', () => {
    expect(nextReviewReason(reviewed, 'edited')).toBe('edited-after-review');
  });

  it('keeps the reason of content already waiting', () => {
    expect(
      nextReviewReason({ reviewReason: 'never-reviewed', reviewedAt: null }, 'edited'),
    ).toBe('never-reviewed');
  });

  it('always puts a republication after suspension first in line', () => {
    expect(
      nextReviewReason(
        { reviewReason: 'edited-after-review', reviewedAt: new Date() },
        'republished-after-suspension',
      ),
    ).toBe('republished-after-suspension');
  });
});

describe('reviewFields', () => {
  const since = new Date('2026-09-01');
  const now = new Date('2026-09-24');

  it('keeps the place in line of content already waiting for the same reason', () => {
    expect(
      reviewFields(
        { reviewReason: 'never-reviewed', reviewPendingSince: since },
        'never-reviewed',
        now,
      ),
    ).toEqual({ reviewReason: 'never-reviewed', reviewPendingSince: since });
  });

  it('starts a new wait when the reason changes, and writes nothing without one', () => {
    expect(
      reviewFields(
        { reviewReason: 'never-reviewed', reviewPendingSince: since },
        'republished-after-suspension',
        now,
      ),
    ).toEqual({ reviewReason: 'republished-after-suspension', reviewPendingSince: now });
    expect(
      reviewFields({ reviewReason: null, reviewPendingSince: null }, null, now),
    ).toEqual({});
  });
});

describe('reviewFlags', () => {
  it('flags free-text values, "no allergens", and why it is back', () => {
    expect(
      reviewFlags({
        reviewReason: 'edited-after-review',
        customAllergens: ['sarrasin'],
        customDiets: [],
        allergensNone: true,
      }),
    ).toEqual(['custom-allergen', 'no-allergens-declared', 'edited-after-review']);
  });
});

it('wants a removal reason of 15 to 500 characters', () => {
  expect(isValidReason('Trop court')).toBe(false);
  expect(isValidReason('   '.repeat(10))).toBe(false);
  expect(
    isValidReason('Le lait n’est pas déclaré alors que la recette en contient.'),
  ).toBe(true);
  expect(isValidReason('x'.repeat(501))).toBe(false);
});

it('counts recurring free-text values, whatever their case or accents', () => {
  expect(
    recurringValues(['Sarrasin', 'sarrasin ', 'Céleri-rave', 'celeri-rave', 'Ail']),
  ).toEqual([
    { value: 'Céleri-rave', count: 2 },
    { value: 'Sarrasin', count: 2 },
    { value: 'Ail', count: 1 },
  ]);
});
