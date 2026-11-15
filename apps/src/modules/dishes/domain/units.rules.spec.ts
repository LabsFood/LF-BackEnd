import {
  UNIT_CODES,
  UNITS,
  displayQuantity,
  roundForDisplay,
  unitFromText,
} from './units.rules';

describe('UNITS (Recettes §4.12)', () => {
  it('lists the 14 fixed units', () => {
    expect(UNIT_CODES).toEqual([
      'g',
      'kg',
      'ml',
      'cl',
      'l',
      'tsp',
      'tbsp',
      'piece',
      'clove',
      'bunch',
      'slice',
      'leaf',
      'pinch',
      'to_taste',
    ]);
    expect(UNITS.find((u) => u.code === 'clove')).toEqual({
      code: 'clove',
      label: 'gousse',
      plural: 'gousses',
    });
  });
});

describe('roundForDisplay', () => {
  it.each([
    ['piece', 2.1, 3],
    ['clove', 0.4, 1],
    ['g', 7.46, 7.5],
    ['g', 46.4, 46],
    ['g', 132.4, 130],
    ['g', 133, 135],
    ['ml', 99.5, 100],
    ['kg', 1.255, 1.26],
    ['tsp', 0.2, 0.5],
    ['tsp', 1.3, 1.5],
    ['tbsp', 1.2, 1],
    ['gousse', 1.234, 1.23],
  ])('%s %p -> %p', (unit, qty, expected) => {
    expect(roundForDisplay(qty, unit)).toBe(expected);
  });
});

describe('displayQuantity', () => {
  it.each([
    [1.5, 'kg', '1,5 kg'],
    [2, 'clove', '2 gousses'],
    [1, 'clove', '1 gousse'],
    [null, 'to_taste', 'selon le goût'],
    [1.234, 'gousse', '1,23 gousse'],
    [0.5, 'tbsp', '0,5 c. à soupe'],
  ])('%p %s -> %s', (qty, unit, expected) => {
    expect(displayQuantity(qty, unit)).toBe(expected);
  });
});

describe('unitFromText', () => {
  it.each([
    ['gr', 'g'],
    ['Litre', 'l'],
    ['grammes', 'g'],
    ['Kilos', 'kg'],
    ['c. à soupe', 'tbsp'],
    ['cas', 'tbsp'],
    ['cuillères à soupe', 'tbsp'],
    ['c. à café', 'tsp'],
    ['cac', 'tsp'],
    ['cuillère à café', 'tsp'],
    ['', 'piece'],
    ['pièce', 'piece'],
    ['u', 'piece'],
    ['pcs', 'piece'],
    ['gousse', 'clove'],
    ['gousses', 'clove'],
    ['botte', 'bunch'],
    ['tranches', 'slice'],
    ['feuilles', 'leaf'],
    ['pincée', 'pinch'],
    ['au goût', 'to_taste'],
    ['Selon le  goût', 'to_taste'],
    ['kg', 'kg'],
    ['to_taste', 'to_taste'],
  ])('%p -> %p', (text, code) => {
    expect(unitFromText(text)).toBe(code);
  });

  it('returns null for an unknown unit', () => {
    expect(unitFromText('poignée')).toBeNull();
  });
});
