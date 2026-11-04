import { allergenStateOf, sameAllergenState } from './allergens.rules';
import type { StoredLine } from './recipe-lines.rules';

const line = (
  name: string,
  allergens: string[],
  extra: Partial<StoredLine> = {},
): StoredLine => ({
  name,
  qty: 1,
  unit: 'g',
  aisle: null,
  link: null,
  toVerify: false,
  fixedQuantity: false,
  catalogIngredientId: `id-${name}`,
  optional: false,
  precision: null,
  preparation: null,
  group: null,
  hiddenFromClient: false,
  rawText: null,
  allergens,
  incomplete: false,
  ...extra,
});

describe('allergenStateOf (Recettes §4.9)', () => {
  it('unions the lines, in annex order, with their sources', () => {
    const s = allergenStateOf(
      [line('Beurre', ['milk']), line('Farine', ['gluten'])],
      [],
      [],
    );
    expect(s.allergens).toEqual(['gluten', 'milk']);
    expect(s.conditionalAllergens).toEqual([]);
    expect(s.sources).toEqual({ gluten: ['Farine'], milk: ['Beurre'] });
    expect(s.complete).toBe(true);
  });

  it('keeps an optional-only allergen in allergens and marks it conditional', () => {
    const s = allergenStateOf([line('Crème', ['milk'], { optional: true })], [], []);
    expect(s.allergens).toEqual(['milk']);
    expect(s.conditionalAllergens).toEqual(['milk']);
  });

  it('is not conditional when a required line brings it too', () => {
    const s = allergenStateOf(
      [line('Crème', ['milk'], { optional: true }), line('Beurre', ['milk'])],
      [],
      [],
    );
    expect(s.conditionalAllergens).toEqual([]);
    expect(s.sources.milk).toEqual(['Crème', 'Beurre']);
  });

  it('is not conditional when the chef added it', () => {
    const s = allergenStateOf(
      [line('Crème', ['milk'], { optional: true })],
      ['milk'],
      [],
    );
    expect(s.allergens).toEqual(['milk']);
    expect(s.conditionalAllergens).toEqual([]);
  });

  it('counts hidden lines, and lists a name once per allergen', () => {
    const s = allergenStateOf(
      [
        line('Oeuf', ['eggs'], { hiddenFromClient: true }),
        line('Oeuf', ['eggs'], { precision: 'bio' }),
      ],
      [],
      [],
    );
    expect(s.allergens).toEqual(['eggs']);
    expect(s.sources).toEqual({ eggs: ['Oeuf'] });
  });

  it('merges chef-added allergens in order, without a source entry', () => {
    const s = allergenStateOf([line('Beurre', ['milk'])], ['gluten'], []);
    expect(s.allergens).toEqual(['gluten', 'milk']);
    expect(s.sources).toEqual({ milk: ['Beurre'] });
  });

  it('says "none" only when everything is known and nothing is declared', () => {
    const lines = [line('Sel', []), line('Eau', [])];
    expect(allergenStateOf(lines, [], []).allergensNone).toBe(true);
    expect(allergenStateOf(lines, [], ['sarrasin']).allergensNone).toBe(false);
    expect(allergenStateOf(lines, ['milk'], []).allergensNone).toBe(false);
  });

  it('is incomplete with an unlinked line, still counting the others', () => {
    const s = allergenStateOf(
      [line('Beurre', ['milk']), line('Mystère', [], { catalogIngredientId: null })],
      [],
      [],
    );
    expect(s.complete).toBe(false);
    expect(s.allergensNone).toBe(false);
    expect(s.allergens).toEqual(['milk']);
  });

  it('keeps the known allergens of an incomplete ingredient, but is incomplete', () => {
    const s = allergenStateOf([line('Beurre', ['milk'], { incomplete: true })], [], []);
    expect(s.allergens).toEqual(['milk']);
    expect(s.sources).toEqual({ milk: ['Beurre'] });
    expect(s.complete).toBe(false);
    expect(s.allergensNone).toBe(false);
  });

  it('keeps an unknown code after the annex ones and is incomplete', () => {
    const s = allergenStateOf([line('Beurre', ['milk', 'Lait'])], [], []);
    expect(s.allergens).toEqual(['milk', 'Lait']);
    expect(s.sources).toEqual({ milk: ['Beurre'], Lait: ['Beurre'] });
    expect(s.complete).toBe(false);
    expect(s.allergensNone).toBe(false);
  });

  it('keeps an unknown chef-added code and is incomplete', () => {
    const s = allergenStateOf([line('Sel', [])], ['dairy', 'gluten'], []);
    expect(s.allergens).toEqual(['gluten', 'dairy']);
    expect(s.complete).toBe(false);
    expect(s.allergensNone).toBe(false);
  });

  it('treats a linked legacy line without `allergens` as incomplete, not none', () => {
    const legacy = { ...line('Sel', []) } as Partial<StoredLine>;
    delete legacy.allergens;
    const s = allergenStateOf([legacy as StoredLine], [], []);
    expect(s.allergens).toEqual([]);
    expect(s.complete).toBe(false);
    expect(s.allergensNone).toBe(false);
  });

  it('brings nothing from an unlinked line that carries allergens', () => {
    const s = allergenStateOf(
      [line('X', ['eggs'], { catalogIngredientId: null })],
      [],
      [],
    );
    expect(s.allergens).toEqual([]);
  });

  it('is incomplete without any line', () => {
    const s = allergenStateOf([], [], []);
    expect(s.complete).toBe(false);
    expect(s.allergensNone).toBe(false);
  });
});

describe('sameAllergenState', () => {
  const a = allergenStateOf([line('Beurre', ['milk'])], [], []);
  it('compares every field', () => {
    expect(
      sameAllergenState(a, allergenStateOf([line('Beurre', ['milk'])], [], [])),
    ).toBe(true);
    expect(sameAllergenState(a, allergenStateOf([line('Lait', ['milk'])], [], []))).toBe(
      false,
    );
    expect(sameAllergenState(a, allergenStateOf([line('Beurre', [])], [], []))).toBe(
      false,
    );
    expect(sameAllergenState(a, { ...a, complete: false })).toBe(false);
  });
});
