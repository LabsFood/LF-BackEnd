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
});
