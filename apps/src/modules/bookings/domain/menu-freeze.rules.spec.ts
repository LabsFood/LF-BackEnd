import { frozenSince, isMenuFrozen, menuFreeze } from './menu-freeze.rules';

describe('menu freeze (Recettes lot 3, LF-0269)', () => {
  const startsAt = new Date('2026-11-20T09:00:00.000Z');

  it('freezes 72 hours before the start', () => {
    expect(frozenSince(startsAt)).toEqual(new Date('2026-11-17T09:00:00.000Z'));
  });

  it('is open until the last millisecond before, frozen from then on', () => {
    expect(isMenuFrozen(startsAt, new Date('2026-11-17T08:59:59.999Z'))).toBe(false);
    expect(isMenuFrozen(startsAt, new Date('2026-11-17T09:00:00.000Z'))).toBe(true);
    expect(isMenuFrozen(startsAt, new Date('2026-11-19T09:00:00.000Z'))).toBe(true);
  });

  it('exposes both fields a booking view shows', () => {
    expect(menuFreeze(startsAt, new Date('2026-11-10T00:00:00.000Z'))).toEqual({
      menuFrozen: false,
      frozenSince: new Date('2026-11-17T09:00:00.000Z'),
    });
  });
});
