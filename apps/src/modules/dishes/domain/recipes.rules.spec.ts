import {
  aggregate,
  applyCorrections,
  diffCorrections,
  groupByAisle,
  scale,
} from './recipes.rules';

const ail = { name: 'Ail', qty: 4, unit: 'gousse', aisle: 'fruits-legumes' };
const poulet = { name: 'Poulet fermier', qty: 1.4, unit: 'kg', aisle: 'boucherie' };

describe('scale', () => {
  it('scales a recipe written for 3 portions to 6', () => {
    expect(scale([ail, poulet], 3, 6)).toEqual([
      { ...ail, qty: 8 },
      { ...poulet, qty: 2.8 },
    ]);
  });

  it('skips stored lines that are not ingredients, and reads legacy `amount`', () => {
    expect(
      scale([{ oignons: 2 }, { name: 'Sel', amount: 1, unit: 'pincée' }], 1, 1),
    ).toEqual([{ name: 'Sel', qty: 1, unit: 'pincée', aisle: 'autre' }]);
    expect(scale({ not: 'a list' }, 1, 1)).toEqual([]);
  });
});

it('rounds half-hundredths up, not down', () => {
  expect(scale([{ ...ail, qty: 1.005 }], 1, 1)[0].qty).toBe(1.01);
});

describe('aggregate', () => {
  it('adds up the same ingredient in the same unit across dishes', () => {
    expect(
      aggregate([ail, { ...ail, name: 'ail', qty: 2 }, { ...ail, unit: 'g', qty: 10 }]),
    ).toEqual([
      { ...ail, qty: 6 },
      { ...ail, unit: 'g', qty: 10 },
    ]);
  });
});

describe('corrections', () => {
  it('stores only what differs from the recipes, and survives a recalculation', () => {
    const computed = [ail, poulet];
    const wanted = [
      { ...ail, qty: 6 },
      { name: 'Citron', qty: 2, unit: 'pièce', aisle: 'fruits-legumes' },
    ];

    const corrections = diffCorrections(computed, wanted);
    expect(corrections).toEqual([
      { ...ail, qty: 6, removed: false },
      { name: 'Citron', qty: 2, unit: 'pièce', aisle: 'fruits-legumes', removed: false },
      { ...poulet, removed: true },
    ]);

    // The recipes give the same lines again: the chef's list comes back unchanged.
    expect(applyCorrections(computed, corrections)).toEqual([
      { ...ail, qty: 6, edited: true },
      { name: 'Citron', qty: 2, unit: 'pièce', aisle: 'fruits-legumes', edited: true },
    ]);
  });

  it('keeps unchanged lines computed, not edited', () => {
    expect(diffCorrections([ail], [ail])).toEqual([]);
    expect(applyCorrections([ail], [])).toEqual([{ ...ail, edited: false }]);
  });
});

it('groups lines by aisle, in first-seen order', () => {
  expect(groupByAisle([ail, poulet, { ...ail, name: 'Oignon' }])).toEqual([
    {
      aisle: 'fruits-legumes',
      lines: [
        { name: 'Ail', qty: 4, unit: 'gousse' },
        { name: 'Oignon', qty: 4, unit: 'gousse' },
      ],
    },
    { aisle: 'boucherie', lines: [{ name: 'Poulet fermier', qty: 1.4, unit: 'kg' }] },
  ]);
});
