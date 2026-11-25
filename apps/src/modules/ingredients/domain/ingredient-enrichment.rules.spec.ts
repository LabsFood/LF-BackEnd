import { DEFAULT_RECIPE_AISLES } from '../../platform-settings/recipe-lists';
import {
  enrichmentSchema,
  missingFieldsPatch,
  parseEnrichment,
  toEnriched,
} from './ingredient-enrichment.rules';

const AISLES = DEFAULT_RECIPE_AISLES.map((a) => a.code);

const sheet = (over: Record<string, unknown> = {}) => ({
  asked: 'beurre doux',
  name: 'beurre doux',
  isIngredient: true,
  aisle: 'cremerie',
  allergens: ['milk'],
  diets: ['vegetarian'],
  seasonMonths: [],
  isBasic: false,
  ...over,
});

describe('ingredient enrichment rules', () => {
  it('offers only the aisles in force', () => {
    const schema = enrichmentSchema([
      { code: 'cremerie', label: 'Crèmerie' },
    ]) as unknown as {
      properties: {
        ingredients: { items: { properties: { aisle: { enum: string[] } } } };
      };
    };
    expect(schema.properties.ingredients.items.properties.aisle.enum).toEqual([
      'cremerie',
    ]);
  });

  it('reads a fenced answer', () => {
    expect(parseEnrichment('```json\n{"ingredients":[]}\n```')).toEqual({
      ingredients: [],
    });
    expect(() => parseEnrichment('{}')).toThrow();
  });

  it('cleans a sheet: capital, implied diets, unknown codes dropped', () => {
    const [s] = toEnriched(
      ['beurre doux'],
      [sheet({ allergens: ['milk', 'bogus'], diets: ['vegetarian', 'keto'] })],
      AISLES,
    );
    expect(s.name).toBe('Beurre doux');
    expect(s.allergens).toEqual(['milk']);
    expect(s.allergensNone).toBe(false);
    expect(s.diets).toEqual(
      expect.arrayContaining(['vegetarian', 'no-pork', 'pescetarian']),
    );
    expect(s.diets).not.toContain('keto');
  });

  it('says "no allergen" explicitly when the list is empty', () => {
    const [s] = toEnriched(
      ['tomate'],
      [sheet({ asked: 'tomate', allergens: [] })],
      AISLES,
    );
    expect(s.allergensNone).toBe(true);
  });

  it('drops a sheet whose aisle is not in force', () => {
    expect(toEnriched(['x'], [sheet({ asked: 'x', aisle: 'cave' })], AISLES)).toEqual([]);
  });

  it('matches by position when the name was not copied back', () => {
    const [s] = toEnriched(
      ['galanga'],
      [sheet({ asked: 'galangal', name: 'Galanga' })],
      AISLES,
    );
    expect(s.asked).toBe('galanga');
  });

  it('treats twelve months as all year', () => {
    const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const [s] = toEnriched(
      ['riz'],
      [sheet({ asked: 'riz', seasonMonths: months })],
      AISLES,
    );
    expect(s.seasonMonths).toEqual([]);
  });

  it('fills only what is empty', () => {
    const [s] = toEnriched(['beurre doux'], [sheet()], AISLES);
    expect(
      missingFieldsPatch(
        { aisle: null, allergens: ['milk'], allergensNone: false, diets: [] },
        s,
      ),
    ).toEqual({ aisle: 'cremerie', diets: s.diets });
    expect(
      missingFieldsPatch(
        { aisle: 'boucherie', allergens: [], allergensNone: false, diets: ['vegan'] },
        s,
      ),
    ).toEqual({ allergens: ['milk'] });
  });
});
