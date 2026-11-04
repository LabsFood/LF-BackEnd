import { classify, unlinkedLines } from './classification.rules';

const tomate = {
  id: 't',
  diets: ['vegan', 'vegetarian', 'no-pork'],
  seasonMonths: [6, 7, 8, 9],
};
const courgette = { id: 'c', diets: ['vegan', 'vegetarian'], seasonMonths: [5, 6, 7, 8] };
const riz = { id: 'r', diets: ['vegan', 'vegetarian', 'no-pork'], seasonMonths: [] };
const catalog = new Map([tomate, courgette, riz].map((i) => [i.id, i]));
const line = (catalogIngredientId: string | null) => ({ name: 'x', catalogIngredientId });

describe('classify (Recettes §4.8)', () => {
  it('keeps the diets every ingredient suits, and the months they share in season', () => {
    expect(classify([line('t'), line('c'), line('r')], catalog)).toEqual({
      diets: ['vegan', 'vegetarian'],
      seasonMonths: [6, 7, 8],
    });
  });

  it('is in season all year when no ingredient is seasonal', () => {
    expect(classify([line('r')], catalog)?.seasonMonths).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });

  it('says nothing ("non calculé") while a line is not linked to the list', () => {
    expect(classify([line('t'), line(null)], catalog)).toBeNull();
    expect(classify([line('gone')], catalog)).toBeNull();
    expect(classify([], catalog)).toBeNull();
  });

  it('counts the lines still to link', () => {
    expect(unlinkedLines([line('t'), line(null), { name: 'y' }])).toBe(2);
  });

  it('ignores optional lines for the seasons, not for the diets', () => {
    const basilic = { id: 'b', diets: ['vegan'], seasonMonths: [5, 6] };
    const cat = new Map([tomate, basilic].map((i) => [i.id, i]));
    const result = classify([line('t'), { ...line('b'), optional: true }], cat);
    expect(result?.seasonMonths).toEqual([6, 7, 8, 9]);
    expect(result?.diets).toEqual(['vegan']);
  });

  it('removes gluten-free once gluten is among the allergens', () => {
    const pain = { id: 'p', diets: ['gluten-free', 'vegan'], seasonMonths: [] };
    const cat = new Map([[pain.id, pain]]);
    expect(classify([line('p')], cat)?.diets).toEqual(['gluten-free', 'vegan']);
    expect(classify([line('p')], cat, ['gluten'])?.diets).toEqual(['vegan']);
    expect(classify([line('p')], cat, ['milk'])?.diets).toEqual(['gluten-free', 'vegan']);
  });

  it('gives no season month when the seasonal ingredients share none', () => {
    const hiver = { id: 'h', diets: [], seasonMonths: [12, 1] };
    const cat = new Map([tomate, hiver].map((i) => [i.id, i]));
    expect(classify([line('t'), line('h')], cat)?.seasonMonths).toEqual([]);
  });
});
