import {
  eatBeforeOpen,
  eatBeforeRefusal,
  eatBeforeView,
  proposedEatBefore,
  sessionDay,
} from './eat-before.rules';

describe('« à manger avant » (Recettes lot 3, LF-0270, LF-0271)', () => {
  // 09:00 in Paris, winter time.
  const startsAt = new Date('2026-11-20T08:00:00.000Z');
  const endsAt = new Date('2026-11-20T11:00:00.000Z');
  const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

  it('counts from the Paris day of the prestation', () => {
    expect(sessionDay(new Date('2026-11-19T23:30:00.000Z'))).toEqual(day('2026-11-20'));
  });

  it('proposes the day plus the fridge days of the pinned recipe', () => {
    expect(proposedEatBefore(startsAt, { method: 'fridge', days: 3 })).toEqual(
      day('2026-11-23'),
    );
    expect(proposedEatBefore(startsAt, null)).toBeNull();
    expect(proposedEatBefore(startsAt, { days: 'trois' })).toBeNull();
  });

  it('stays open until 24 hours after the end', () => {
    expect(eatBeforeOpen(endsAt, new Date('2026-11-21T10:59:59.000Z'))).toBe(true);
    expect(eatBeforeOpen(endsAt, new Date('2026-11-21T11:00:00.000Z'))).toBe(false);
  });

  it('refuses a date before the prestation or more than a year after', () => {
    expect(eatBeforeRefusal(startsAt, day('2026-11-19'))).toMatch(/before/);
    expect(eatBeforeRefusal(startsAt, day('2027-11-22'))).toMatch(/366/);
    expect(eatBeforeRefusal(startsAt, day('2026-11-20'))).toBeNull();
  });

  it('shows the chef’s date over the proposed one, and alerts past the threshold', () => {
    const storage = { days: 3 };
    expect(
      eatBeforeView(startsAt, storage, { eatBefore: null, eatBeforeSetAt: null }, 4),
    ).toEqual({
      date: '2026-11-23',
      proposed: '2026-11-23',
      setByChef: false,
      setAt: null,
      fridgeDays: 3,
      fridgeAlert: false,
    });
    const setAt = new Date('2026-11-20T12:00:00.000Z');
    expect(
      eatBeforeView(
        startsAt,
        storage,
        { eatBefore: day('2026-11-25'), eatBeforeSetAt: setAt },
        4,
      ),
    ).toMatchObject({
      date: '2026-11-25',
      setByChef: true,
      fridgeDays: 5,
      fridgeAlert: true,
    });
  });
});
