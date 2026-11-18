import {
  aggregate,
  applyCorrections,
  diffCorrections,
  groupByAisle,
  householdPortions,
  readSteps,
  recipeLimitBreach,
  roundLines,
  sameContent,
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

describe('portions (Recettes §4.12)', () => {
  const sel = {
    name: 'Sel',
    qty: 1,
    unit: 'pincée',
    aisle: 'epicerie',
    fixedQuantity: true,
  };

  it('keeps a fixed quantity whatever the portions, and rounds nothing on the way', () => {
    expect(scale([{ ...ail, qty: 1 }, sel], 3, 4)).toEqual([
      { ...ail, qty: 4 / 3 },
      { name: 'Sel', qty: 1, unit: 'pincée', aisle: 'epicerie' },
    ]);
  });

  it('adds up before rounding, so small errors do not pile up', () => {
    const third = { ...ail, qty: 1 / 3 };
    expect(roundLines(aggregate([third, third, third]))).toEqual([{ ...ail, qty: 1 }]);
  });

  it('rounds each unit its own way, and a count of pieces to the next whole one', () => {
    expect(roundLines([{ ...ail, unit: 'kg', qty: 1.005 }])[0].qty).toBe(1.01);
    expect(roundLines([{ ...ail, unit: 'g', qty: 133 }])[0].qty).toBe(135);
    expect(roundLines([{ ...ail, unit: 'inconnue', qty: 1.234 }])[0].qty).toBe(1.23);
    expect(
      roundLines([
        { name: 'Citron', qty: 1.2, unit: 'pièce', aisle: 'fruits-legumes' },
      ])[0].qty,
    ).toBe(2);
  });

  it('counts a child as half a portion (BLK-27), one portion at least', () => {
    expect(householdPortions(2, 1)).toBe(2.5);
    expect(householdPortions(1, 0)).toBe(1);
    expect(householdPortions(0, 0)).toBe(1);
  });
});

it('keeps a to_taste line with no quantity', () => {
  expect(scale([{ name: 'Sel', unit: 'to_taste' }], 1, 2)).toEqual([
    { name: 'Sel', qty: 0, unit: 'to_taste', aisle: 'autre' },
  ]);
  expect(scale([{ name: 'Sel', unit: 'g' }], 1, 2)).toEqual([]);
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

  it('keeps a line optional only when every dish that asks for it says so (16/11)', () => {
    const persil = { name: 'Persil', qty: 1, unit: 'bunch', aisle: 'fruits-legumes' };
    expect(
      aggregate([
        { ...persil, optional: true },
        { ...persil, optional: true },
      ]),
    ).toEqual([{ ...persil, qty: 2, optional: true }]);
    expect(aggregate([{ ...persil, optional: true }, persil])).toEqual([
      { ...persil, qty: 2 },
    ]);
    expect(aggregate([persil, { ...persil, optional: true }])).toEqual([
      { ...persil, qty: 2 },
    ]);
  });

  it('reads the optional flag of a stored line, and nothing of hiddenFromClient', () => {
    expect(
      scale(
        [
          {
            name: 'Persil',
            qty: 1,
            unit: 'bunch',
            optional: true,
            hiddenFromClient: true,
          },
        ],
        2,
        2,
      ),
    ).toEqual([
      { name: 'Persil', qty: 1, unit: 'bunch', aisle: 'autre', optional: true },
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

describe('groupByAisle (Recettes §5.4)', () => {
  const ORDER = ['boucherie', 'fruits-legumes'];

  it('puts the aisles in store order, whatever the order of the lines', () => {
    expect(groupByAisle([ail, poulet, { ...ail, name: 'Oignon' }], ORDER)).toEqual([
      { aisle: 'boucherie', lines: [{ name: 'Poulet fermier', qty: 1.4, unit: 'kg' }] },
      {
        aisle: 'fruits-legumes',
        lines: [
          { name: 'Ail', qty: 4, unit: 'gousse' },
          { name: 'Oignon', qty: 4, unit: 'gousse' },
        ],
      },
    ]);
  });

  it('puts unknown aisles last, in first-seen order', () => {
    const line = (name: string, aisle: string) => ({ name, qty: 1, unit: 'g', aisle });
    const groups = groupByAisle(
      [
        line('A', 'Rayon libre'),
        line('B', 'autre'),
        line('C', 'boucherie'),
        line('D', 'Rayon libre'),
      ],
      ORDER,
    );
    expect(groups.map((g) => g.aisle)).toEqual(['boucherie', 'Rayon libre', 'autre']);
    expect(groups[1].lines.map((l) => l.name)).toEqual(['A', 'D']);
  });

  it('keeps a to_taste line, without quantity, in its aisle', () => {
    const salt = { name: 'Sel', qty: 0, unit: 'to_taste', aisle: 'epices' };
    expect(groupByAisle([salt], ['epices'])).toEqual([
      { aisle: 'epices', lines: [{ name: 'Sel', qty: 0, unit: 'to_taste' }] },
    ]);
  });
});

it('adds two to_taste lines of the same ingredient into one', () => {
  const salt = { name: 'Sel', qty: 0, unit: 'to_taste', aisle: 'epices' };
  expect(aggregate([salt, { ...salt, name: 'sel' }])).toEqual([salt]);
});

describe('recipeLimitBreach (BLK-28)', () => {
  it('lets a recipe at the caps through', () => {
    expect(recipeLimitBreach(60, Array(40).fill('x'.repeat(2000)))).toBeNull();
  });

  it('names the first cap broken, with its maximum', () => {
    expect(recipeLimitBreach(61, [])).toEqual({ limit: 'ingredients', max: 60 });
    expect(recipeLimitBreach(1, Array(41).fill('x'))).toEqual({
      limit: 'steps',
      max: 40,
    });
    expect(recipeLimitBreach(1, ['x'.repeat(2001)])).toEqual({
      limit: 'stepLength',
      max: 2000,
    });
  });
});

describe('readSteps (§4.5)', () => {
  it('numbers the steps by position and keeps their type and duration', () => {
    expect(
      readSteps([
        { order: 9, text: 'Éplucher', type: 'preparation', durationMinutes: 10 },
        { text: 'Cuire', type: null },
      ]),
    ).toEqual([
      { order: 1, text: 'Éplucher', type: 'preparation', durationMinutes: 10 },
      { order: 2, text: 'Cuire', type: null, durationMinutes: null },
    ]);
  });

  it('reads a step stored as plain text, before steps had a type', () => {
    expect(readSteps(['Éplucher'])).toEqual([
      { order: 1, text: 'Éplucher', type: null, durationMinutes: null },
    ]);
  });

  it('skips what is not a step, and forgets a type outside the list', () => {
    expect(readSteps([{}, 3, '', { text: 'Dresser', type: 'flambage' }])).toEqual([
      { order: 1, text: 'Dresser', type: null, durationMinutes: null },
    ]);
    expect(readSteps(null)).toEqual([]);
  });
});

describe('sameContent', () => {
  it('compares stored JSON whatever the key order the database gives back', () => {
    expect(sameContent([{ qty: 4, name: 'Ail' }], [{ name: 'Ail', qty: 4 }])).toBe(true);
    expect(sameContent([{ name: 'Ail', qty: 4 }], [{ name: 'Ail', qty: 5 }])).toBe(false);
    expect(sameContent(null, null)).toBe(true);
  });
});
