import {
  isEntryComplete,
  matchKey,
  normalizeName,
  withImpliedDiets,
} from './ingredient.rules';

describe('normalizeName (Recettes §5.1)', () => {
  it('folds case, accents, ligatures and spaces', () => {
    expect(normalizeName(' Œufs  de  Caille ')).toBe('oeufs de caille');
    expect(normalizeName('Æther')).toBe('aether');
    expect(normalizeName('Échalote')).toBe('echalote');
  });
});

describe('matchKey', () => {
  it('matches a singular and its plural', () => {
    expect(matchKey('Tomates')).toBe(matchKey('tomate'));
    expect(matchKey('Noix de coco')).toBe(matchKey('noix de cocos'));
  });

  it('keeps the end of words of three letters or fewer', () => {
    expect(matchKey('Riz')).toBe('riz');
  });
});

describe('withImpliedDiets', () => {
  it('adds what a diet implies, in the order of the computed diets', () => {
    expect(withImpliedDiets(['vegan'])).toEqual([
      'vegetarian',
      'vegan',
      'no-pork',
      'pescetarian',
    ]);
    expect(withImpliedDiets(['vegetarian'])).toEqual([
      'vegetarian',
      'no-pork',
      'pescetarian',
    ]);
    expect(withImpliedDiets(['gluten-free', 'gluten-free'])).toEqual(['gluten-free']);
    expect(withImpliedDiets([])).toEqual([]);
  });
});

describe('isEntryComplete', () => {
  const base = { aisle: 'epicerie', allergens: ['gluten'], allergensNone: false };
  it('needs an aisle', () => {
    expect(isEntryComplete({ ...base, aisle: null })).toBe(false);
  });
  it('needs allergens or an explicit "none"', () => {
    expect(isEntryComplete({ ...base, allergens: [] })).toBe(false);
    expect(isEntryComplete({ ...base, allergens: [], allergensNone: true })).toBe(true);
    expect(isEntryComplete(base)).toBe(true);
  });
});
