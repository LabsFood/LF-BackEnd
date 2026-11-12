import {
  compositionChanged,
  duplicateLines,
  lineInputProblems,
  readLines,
  reverifyNeeded,
  toLineInput,
  type LineInput,
  type SafetySnapshot,
} from './recipe-lines.rules';

const line = (over: Partial<LineInput> = {}): LineInput => ({
  name: 'Ail',
  qty: 1,
  unit: 'clove',
  aisle: 'fruits-legumes',
  link: null,
  toVerify: false,
  fixedQuantity: false,
  catalogIngredientId: 'ing-ail',
  optional: false,
  precision: null,
  preparation: null,
  group: null,
  hiddenFromClient: false,
  rawText: null,
  ...over,
});

describe('toLineInput', () => {
  it('gives a legacy line its defaults and converts the unit text', () => {
    expect(
      toLineInput({ name: 'Ail', qty: 2, unit: 'gousse', aisle: 'legumes' }),
    ).toEqual(
      line({
        qty: 2,
        unit: 'clove',
        aisle: 'legumes',
        catalogIngredientId: null,
      }),
    );
  });

  it('sends an unknown unit to verification and keeps the original text', () => {
    expect(toLineInput({ name: ' Sel  fin ', qty: 3, unit: 'poignée' })).toMatchObject({
      toVerify: true,
      unit: null,
      rawText: '3 poignée Sel fin',
    });
  });

  // R33: an unreadable quantity is no number the line can be held as: the line waits
  // for the chef with the words as typed, as an unknown unit does.
  it('sends a quantity it cannot read to verification, with the original words', () => {
    for (const qty of ['1/2', '1,5', 'un peu']) {
      expect(toLineInput({ name: 'Beurre', qty, unit: 'g' })).toMatchObject({
        qty: null,
        unit: 'g',
        toVerify: true,
        rawText: `${qty} g Beurre`,
      });
    }
    // The words the line already had win, linked or not.
    expect(
      toLineInput({
        name: 'Beurre',
        qty: '1/2',
        unit: 'g',
        rawText: 'une demi-plaquette',
        catalogIngredientId: 'cat-beurre',
      }),
    ).toMatchObject({
      toVerify: true,
      rawText: 'une demi-plaquette',
      catalogIngredientId: 'cat-beurre',
    });
  });

  it('reads a numeric string, and leaves to_taste and an empty quantity alone', () => {
    expect(toLineInput({ name: 'Riz', qty: '250', unit: 'g' })).toMatchObject({
      qty: 250,
      toVerify: false,
      rawText: null,
    });
    expect(toLineInput({ name: 'Sel', qty: 'au goût', unit: 'to_taste' })).toMatchObject({
      qty: null,
      toVerify: false,
    });
    expect(toLineInput({ name: 'Riz', qty: '', unit: 'g' })).toMatchObject({
      qty: null,
      toVerify: false,
    });
  });

  it('keeps a valid unit', () => {
    expect(toLineInput({ name: 'Riz', qty: 100, unit: 'g' })).toMatchObject({
      unit: 'g',
      toVerify: false,
      rawText: null,
    });
  });

  it('keeps a to-verify line as stored', () => {
    expect(
      toLineInput({
        name: 'X',
        qty: null,
        unit: null,
        toVerify: true,
        rawText: 'un peu de X',
      }),
    ).toMatchObject({ toVerify: true, unit: null, qty: null, rawText: 'un peu de X' });
  });

  it('reads a legacy to_taste quantity of zero as no quantity', () => {
    expect(toLineInput({ name: 'Sel', qty: 0, unit: 'to_taste' }).qty).toBeNull();
  });
});

describe('readLines', () => {
  it('makes every field explicit and skips what is not a line', () => {
    const lines = readLines([
      { name: 'Ail', qty: 1, unit: 'clove', allergens: ['mustard'], incomplete: true },
      { name: 'Sel', qty: null, unit: 'to_taste' },
      null,
      'x',
      { qty: 2 },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      allergens: ['mustard'],
      incomplete: true,
      optional: false,
    });
    expect(lines[1]).toMatchObject({ allergens: [], incomplete: false, group: null });
  });

  it('returns nothing for a non-array', () => {
    expect(readLines(undefined)).toEqual([]);
  });
});

describe('lineInputProblems (Recettes §5.2)', () => {
  it('needs a quantity unless to taste or to verify', () => {
    expect(lineInputProblems([line({ qty: null, unit: 'g' })])).toEqual([
      expect.objectContaining({ field: 'recipe.ingredients[0].qty' }),
    ]);
  });

  it('rejects a quantity of zero or less', () => {
    expect(lineInputProblems([line({ qty: 0 })])).toHaveLength(1);
    expect(lineInputProblems([line({ qty: -1 })])).toHaveLength(1);
  });

  it('rejects a quantity with to_taste', () => {
    const problems = lineInputProblems([line({ qty: 2, unit: 'to_taste' })]);
    expect(problems).toEqual([
      expect.objectContaining({ field: 'recipe.ingredients[0].qty' }),
    ]);
  });

  it('accepts to_taste without quantity', () => {
    expect(lineInputProblems([line({ qty: null, unit: 'to_taste' })])).toEqual([]);
  });

  it('needs a unit unless to verify', () => {
    expect(lineInputProblems([line({ unit: null })])).toEqual([
      expect.objectContaining({ field: 'recipe.ingredients[0].unit' }),
    ]);
  });

  it('rejects an unknown unit and a missing name', () => {
    const problems = lineInputProblems([line({ unit: 'poignée', name: ' ' })]);
    expect(problems.map((p) => p.field)).toEqual([
      'recipe.ingredients[0].name',
      'recipe.ingredients[0].unit',
    ]);
  });

  it('accepts a to-verify line with neither quantity nor unit', () => {
    expect(lineInputProblems([line({ toVerify: true, qty: null, unit: null })])).toEqual(
      [],
    );
  });

  it('numbers the lines', () => {
    const problems = lineInputProblems([line(), line({ qty: 0 })]);
    expect(problems[0].field).toBe('recipe.ingredients[1].qty');
  });
});

describe('duplicateLines (R10)', () => {
  it('finds the same ingredient, group and precision whatever the case', () => {
    expect(
      duplicateLines([line({ precision: 'Bio' }), line({ precision: 'bio' })]),
    ).toEqual([[0, 1]]);
  });

  it('lets the same ingredient sit in different groups or precisions', () => {
    expect(duplicateLines([line({ group: 'Sauce' }), line({ group: 'Pâte' })])).toEqual(
      [],
    );
    expect(duplicateLines([line({ precision: 'Bio' }), line()])).toEqual([]);
  });

  it('ignores unlinked lines', () => {
    expect(
      duplicateLines([
        line({ catalogIngredientId: null }),
        line({ catalogIngredientId: null }),
      ]),
    ).toEqual([]);
  });
});

describe('compositionChanged (Recettes §6.5)', () => {
  const ail = line();
  const poulet = line({ name: 'Poulet', catalogIngredientId: 'ing-poulet' });

  it('ignores order, quantity, unit, precision, preparation, group and aisle', () => {
    expect(
      compositionChanged(
        [ail, poulet],
        [
          { ...poulet, qty: 9, unit: 'kg', precision: 'fermier', preparation: 'émincé' },
          { ...ail, group: 'Sauce', aisle: 'autre' },
        ],
      ),
    ).toBe(false);
  });

  it('sees a line added or removed', () => {
    expect(compositionChanged([ail], [ail, poulet])).toBe(true);
    expect(compositionChanged([ail, poulet], [ail])).toBe(true);
  });

  it('sees an ingredient change, even under the same name', () => {
    expect(
      compositionChanged([ail], [{ ...ail, catalogIngredientId: 'ing-autre' }]),
    ).toBe(true);
  });

  it('sees optional switched', () => {
    expect(compositionChanged([ail], [{ ...ail, optional: true }])).toBe(true);
  });

  it('counts the name of an unlinked line only', () => {
    const free = line({ catalogIngredientId: null });
    expect(compositionChanged([free], [{ ...free, name: 'Échalote' }])).toBe(true);
    expect(compositionChanged([free], [{ ...free, name: 'AIL' }])).toBe(false);
    expect(compositionChanged([ail], [{ ...ail, name: 'Ail des ours' }])).toBe(false);
  });

  it('still catches a renamed legacy ingredient (lot 2, R17)', () => {
    const legacy = { name: 'Ail', qty: 1, unit: 'gousse' };
    expect(compositionChanged([legacy], [{ ...legacy, qty: 5 }])).toBe(false);
    expect(compositionChanged([legacy], [{ ...legacy, name: 'Échalote' }])).toBe(true);
  });
});

describe('reverifyNeeded (Recettes §6.5)', () => {
  const snapshot = (over: Partial<SafetySnapshot> = {}): SafetySnapshot => ({
    ingredients: [line()],
    addedAllergens: ['egg', 'milk'],
    customAllergens: [],
    allergens: ['mustard'],
    conditionalAllergens: [],
    ...over,
  });

  it('is false when only a precision changes', () => {
    expect(
      reverifyNeeded(snapshot(), snapshot({ ingredients: [line({ precision: 'Bio' })] })),
    ).toBe(false);
  });

  it('is true when the composition changes', () => {
    expect(reverifyNeeded(snapshot(), snapshot({ ingredients: [] }))).toBe(true);
  });

  it('compares added and custom allergens as sets', () => {
    expect(
      reverifyNeeded(snapshot(), snapshot({ addedAllergens: ['milk', 'egg'] })),
    ).toBe(false);
    expect(reverifyNeeded(snapshot(), snapshot({ addedAllergens: ['egg'] }))).toBe(true);
    expect(reverifyNeeded(snapshot(), snapshot({ customAllergens: ['kiwi'] }))).toBe(
      true,
    );
  });

  it('is true when the computed allergens change', () => {
    expect(reverifyNeeded(snapshot(), snapshot({ allergens: [] }))).toBe(true);
    expect(reverifyNeeded(snapshot(), snapshot({ conditionalAllergens: ['nuts'] }))).toBe(
      true,
    );
  });
});
