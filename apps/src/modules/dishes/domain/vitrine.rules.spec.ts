import {
  coveredDiets,
  coversArea,
  parisDay,
  parisMidnight,
  vitrineOrder,
  weekOf,
} from './vitrine.rules';

describe('weeks', () => {
  it('runs Monday to Sunday', () => {
    expect(weekOf('2026-09-24')).toEqual({ start: '2026-09-21', end: '2026-09-27' });
    expect(weekOf('2026-09-21')).toEqual({ start: '2026-09-21', end: '2026-09-27' });
    expect(weekOf('2026-09-27')).toEqual({ start: '2026-09-21', end: '2026-09-27' });
  });

  it('begins a Paris day at 22:00 UTC in summer and 23:00 UTC in winter', () => {
    expect(parisMidnight('2026-09-21').toISOString()).toBe('2026-09-20T22:00:00.000Z');
    expect(parisMidnight('2026-12-07').toISOString()).toBe('2026-12-06T23:00:00.000Z');
  });

  it('starts on a French Monday, not a UTC one', () => {
    // Sunday 23:30 UTC is already Monday in Paris.
    expect(parisDay(new Date('2026-09-27T22:30:00Z'))).toBe('2026-09-28');
  });
});

describe('coversArea', () => {
  const zones = [
    { regionCode: '93', scope: 'cities' as const, cities: [{ insee: '06088' }] },
    { regionCode: '84', scope: 'region' as const, cities: [] },
  ];

  it('covers everything when no area is asked', () => {
    expect(coversArea(zones, {})).toBe(true);
  });

  it('matches a region, a listed city, or a city inside a whole-region zone', () => {
    expect(coversArea(zones, { region: '93' })).toBe(true);
    expect(coversArea(zones, { region: '11' })).toBe(false);
    expect(coversArea(zones, { city: '06088' })).toBe(true);
    expect(coversArea(zones, { region: '93', city: '06004' })).toBe(false);
    expect(coversArea(zones, { region: '84', city: '69123' })).toBe(true);
  });
});

describe('coveredDiets', () => {
  it('keeps only the diets every dish satisfies', () => {
    expect(
      coveredDiets([{ diets: ['gluten-free', 'halal'] }, { diets: ['gluten-free'] }]),
    ).toEqual(['gluten-free']);
    expect(coveredDiets([])).toEqual([]);
  });
});

describe('vitrineOrder', () => {
  const cards = ['a', 'b', 'c', 'd', 'e'].map((chefId, i) => ({
    chefId,
    hasMenu: i !== 0,
  }));

  it('puts chefs without a menu last', () => {
    const order = vitrineOrder(cards, '2026-09-24');
    expect(order[order.length - 1].chefId).toBe('a');
  });

  it('is stable within a month and changes between months', () => {
    const ids = (day: string) => vitrineOrder(cards, day).map((c) => c.chefId);
    expect(ids('2026-09-01')).toEqual(ids('2026-09-30'));
    const months = ['2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01'].map(ids);
    expect(months.some((order) => order.join() !== ids('2026-09-01').join())).toBe(true);
  });
});
