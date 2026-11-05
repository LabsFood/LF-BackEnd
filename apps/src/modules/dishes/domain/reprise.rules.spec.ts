import { EntryRow, stampLines } from '../../ingredients/composition';
import { matchKey } from '../../ingredients/domain/ingredient.rules';
import { allergenStateOf } from './allergens.rules';
import { toLineInput } from './recipe-lines.rules';
import {
  ambiguousKeys,
  matchIndex,
  missingAllergens,
  repriseDish,
  repriseLine,
} from './reprise.rules';

/** An entry of the common list, as `stampLines` reads it. */
const entry = (
  id: string,
  name: string,
  allergens: string[] = [],
  aliases: string[] = [],
): EntryRow & { aliases: string[] } => ({
  id,
  name,
  aliases,
  aisle: 'epicerie-salee',
  allergens,
  allergensNone: allergens.length === 0,
  isBasic: false,
  diets: [],
  seasonMonths: [],
  status: 'active',
  chefProfileId: null,
  mergedIntoId: null,
});

const ENTRIES = [
  entry('cat-tomate', 'Tomate'),
  entry('cat-ail', 'Ail'),
  entry('cat-basilic', 'Basilic'),
  entry('cat-beurre', 'Beurre', ['milk'], ['beurre doux']),
  entry('cat-farine', 'Farine de blé', ['gluten'], ['farine']),
  entry('cat-oeuf', 'Œuf', ['eggs']),
  entry('cat-saumon', 'Saumon', ['fish']),
  entry('cat-noix', 'Noix', ['nuts']),
];
const INDEX = matchIndex(ENTRIES);
/** The entries by id, as `entriesFor` would read them from the database. */
const BY_ID = new Map<string, EntryRow>(ENTRIES.map((e) => [e.id, e]));

describe('matchIndex (Recettes §9)', () => {
  it('keys every name and other name by its match key', () => {
    expect(INDEX.get(matchKey('Tomates'))).toBe('cat-tomate');
    expect(INDEX.get(matchKey('Beurre doux'))).toBe('cat-beurre');
    expect(INDEX.get(matchKey('farine'))).toBe('cat-farine');
    expect(INDEX.get(matchKey('oeufs'))).toBe('cat-oeuf');
  });

  it('drops a key two entries share: no guess, and it is reported', () => {
    const entries = [
      entry('cat-a', 'Crème', [], ['creme fraiche']),
      entry('cat-b', 'Crème fraîche'),
      entry('cat-c', 'Persil', [], ['persil plat', 'Persils']),
    ];
    const index = matchIndex(entries);
    expect(index.has('creme fraiche')).toBe(false);
    expect(index.get('creme')).toBe('cat-a');
    // One entry saying the same name twice is not ambiguous.
    expect(index.get('persil')).toBe('cat-c');
    expect(ambiguousKeys(entries)).toEqual([
      { key: 'creme fraiche', ids: ['cat-a', 'cat-b'] },
    ]);
  });

  it('ignores blank names', () => {
    expect(matchIndex([entry('cat-x', ' ', [], [''])]).size).toBe(0);
  });
});

describe('repriseLine (Recettes §9)', () => {
  it('links « Tomates » to the entry « Tomate »', () => {
    expect(repriseLine({ name: 'Tomates', qty: 4, unit: 'pièces' }, INDEX)).toEqual({
      ...toLineInput({ name: 'Tomates', qty: 4, unit: 'piece' }),
      catalogIngredientId: 'cat-tomate',
    });
  });

  it('does not link « tomates cerises » when only « Tomate » exists: no approximation', () => {
    const line = repriseLine({ name: 'tomates cerises', qty: 200, unit: 'g' }, INDEX);
    expect(line).toMatchObject({
      catalogIngredientId: null,
      toVerify: true,
      unit: 'g',
      qty: 200,
      rawText: '200 g tomates cerises',
    });
  });

  it('keeps an already linked line as it is', () => {
    // Its name would match another entry: the chef's link wins.
    const raw = {
      name: 'Tomate',
      qty: 2,
      unit: 'piece',
      catalogIngredientId: 'cat-private-tomate',
      optional: true,
      precision: 'bio',
    };
    expect(repriseLine(raw, INDEX)).toEqual(toLineInput(raw));
  });

  it('converts « gousse » to clove', () => {
    expect(repriseLine({ name: 'Ail', qty: 2, unit: 'gousse' }, INDEX)).toMatchObject({
      unit: 'clove',
      qty: 2,
      catalogIngredientId: 'cat-ail',
      toVerify: false,
      rawText: null,
    });
  });

  it('sends « poignée » to verification, unit null, with the original words', () => {
    expect(
      repriseLine({ name: 'Basilic', qty: 1, unit: 'poignée' }, INDEX),
    ).toMatchObject({
      catalogIngredientId: 'cat-basilic',
      toVerify: true,
      unit: null,
      rawText: '1 poignée Basilic',
    });
  });

  it('keeps the quantity as written in the original words of an unlinked line', () => {
    expect(repriseLine({ name: 'Citron', qty: '1/2', unit: '' }, INDEX)).toMatchObject({
      catalogIngredientId: null,
      toVerify: true,
      qty: null,
      rawText: '1/2 Citron',
    });
  });

  it('keeps the original words an unlinked line already has', () => {
    expect(
      repriseLine(
        { name: 'Épices', qty: null, unit: null, toVerify: true, rawText: 'un peu' },
        INDEX,
      ),
    ).toMatchObject({ toVerify: true, unit: null, rawText: 'un peu' });
  });
});

describe('repriseDish (Recettes §9)', () => {
  const dish = (over: Record<string, unknown> = {}) => ({
    ingredients: [] as unknown,
    allergens: [] as string[],
    addedAllergens: [] as string[],
    customAllergens: [] as string[],
    storage: null as unknown,
    ...over,
  });

  it('moves the declared allergens into addedAllergens, in annex order', () => {
    const result = repriseDish(
      dish({ allergens: ['milk', 'gluten'], addedAllergens: ['celery'] }),
      INDEX,
    );
    expect(result.addedAllergens).toEqual(['gluten', 'milk', 'celery']);
  });

  it('keeps a legacy allergen code, after the annex ones', () => {
    const result = repriseDish(dish({ allergens: ['arachide', 'eggs'] }), INDEX);
    expect(result.addedAllergens).toEqual(['eggs', 'arachide']);
  });

  it('does not add what stamped lines already bring: a second pass changes nothing', () => {
    const stamped = {
      ...toLineInput({ name: 'Farine de blé', qty: 200, unit: 'g' }),
      catalogIngredientId: 'cat-farine',
      allergens: ['gluten'],
      incomplete: false,
    };
    const result = repriseDish(
      dish({ ingredients: [stamped], allergens: ['gluten'], addedAllergens: [] }),
      INDEX,
    );
    expect(result.addedAllergens).toEqual([]);
  });

  it('says a dish stored in the freezer can be frozen', () => {
    const result = repriseDish(
      dish({ storage: { method: 'freezer', days: 90, container: 'Boîte' } }),
      INDEX,
    );
    expect(result.storage).toEqual({
      method: 'freezer',
      days: 90,
      container: 'Boîte',
      freezable: true,
    });
  });

  it('leaves any other storage unanswered, and an answer as it is', () => {
    const fridge = { method: 'fridge', days: 3 };
    expect(repriseDish(dish({ storage: fridge }), INDEX).storage).toEqual(fridge);
    const answered = { method: 'freezer', days: 30, freezable: false };
    expect(repriseDish(dish({ storage: answered }), INDEX).storage).toEqual(answered);
    expect(repriseDish(dish({ storage: null }), INDEX).storage).toBeNull();
  });

  it('counts the lines to verify, and skips entries that are not lines', () => {
    const result = repriseDish(
      dish({
        ingredients: [
          { name: 'Tomates', qty: 3, unit: '' },
          { name: 'Basilic', qty: 1, unit: 'poignée' },
          { name: 'Huile de noix', qty: 2, unit: 'cas' },
          { name: '  ', qty: 1 },
          'Sel',
          null,
        ],
      }),
      INDEX,
    );
    expect(result.lines.map((l) => l.name)).toEqual([
      'Tomates',
      'Basilic',
      'Huile de noix',
    ]);
    expect(result.linesToVerify).toBe(2);
  });

  it('gives the same result when run again on what it produced', () => {
    const legacy = dish({
      ingredients: [
        { name: 'Tomates', qty: 3, unit: '' },
        { name: 'Basilic', qty: 1, unit: 'poignée' },
        { name: 'Lardons', qty: 150, unit: 'gr' },
        { name: 'Beurre doux', qty: 20, unit: 'grammes' },
      ],
      allergens: ['milk', 'sesame'],
      storage: { method: 'freezer', days: 60 },
    });
    const first = repriseDish(legacy, INDEX);
    const stored = JSON.parse(JSON.stringify(stampLines(first.lines, BY_ID)));
    const state = allergenStateOf(
      stampLines(first.lines, BY_ID),
      first.addedAllergens,
      [],
    );
    const again = repriseDish(
      {
        ingredients: stored,
        allergens: state.allergens,
        addedAllergens: first.addedAllergens,
        customAllergens: [],
        storage: first.storage,
      },
      INDEX,
    );
    expect(stampLines(again.lines, BY_ID)).toEqual(stored);
    expect(again.addedAllergens).toEqual(first.addedAllergens);
    expect(again.storage).toEqual(first.storage);
  });
});

describe('missingAllergens', () => {
  it('lists the codes of the first list the second lacks, in annex order', () => {
    expect(missingAllergens(['milk', 'gluten', 'arachide'], ['milk'])).toEqual([
      'gluten',
      'arachide',
    ]);
    expect(missingAllergens(['milk'], ['milk', 'eggs'])).toEqual([]);
  });
});

/**
 * Review Focus point 3, Recettes §9 and §11: the reprise never makes an allergen
 * disappear. Each dish below is stamped from the entries as `compositionOf` would,
 * and its allergens after must contain every allergen it had before.
 */
describe('the reprise never loses an allergen (Review Focus 3)', () => {
  const DISHES = [
    {
      label: 'legacy lines, linked and not, declared allergens with and without lines',
      ingredients: [
        { name: 'Farine', qty: 200, unit: 'gr' },
        { name: 'Oeufs', qty: 3, unit: '' },
        { name: 'Beurre doux', qty: 50, unit: 'g' },
        { name: 'Lardons fumés', qty: 150, unit: 'grammes' },
      ],
      allergens: ['gluten', 'eggs', 'mustard'],
    },
    {
      label: 'declared "none", lines bringing nothing or unknown units',
      ingredients: [
        { name: 'Tomates', qty: 4, unit: 'pièces' },
        { name: 'Basilic', qty: 1, unit: 'poignée' },
        { name: "Huile d'olive", qty: 2, unit: 'c. à soupe' },
      ],
      allergens: [],
      allergensNone: true,
    },
    {
      label: 'custom allergens, nothing linked',
      ingredients: [
        { name: 'Pâte de sésame', qty: 2, unit: 'cas' },
        { name: 'Cacahuètes', qty: 50, unit: 'g' },
      ],
      allergens: ['sesame', 'peanuts'],
      customAllergens: ['kiwi'],
    },
    {
      label: 'already stamped, with an allergen the chef added',
      ingredients: [
        {
          ...toLineInput({ name: 'Farine de blé', qty: 200, unit: 'g' }),
          catalogIngredientId: 'cat-farine',
          allergens: ['gluten'],
          incomplete: false,
        },
      ],
      allergens: ['gluten', 'nuts'],
      addedAllergens: ['nuts'],
    },
    {
      label: 'an optional line bringing a declared allergen',
      ingredients: [
        { name: 'Noix', qty: 30, unit: 'g', optional: true },
        { name: 'Saumon', qty: 300, unit: 'g' },
      ],
      allergens: ['nuts', 'fish', 'milk'],
    },
    {
      label: 'a legacy allergen code',
      ingredients: [{ name: 'Farine', qty: 100, unit: 'g' }],
      allergens: ['gluten', 'arachide'],
    },
    {
      label: 'a lot 2 link without stamped allergens',
      ingredients: [
        { name: 'Saumon', qty: 200, unit: 'g', catalogIngredientId: 'cat-saumon' },
      ],
      allergens: ['fish'],
    },
    {
      label: 'a link to an entry that no longer exists',
      ingredients: [
        { name: 'Soja', qty: 1, unit: 'tbsp', catalogIngredientId: 'cat-gone' },
      ],
      allergens: ['soy'],
    },
    {
      label: 'no line at all',
      ingredients: [],
      allergens: ['celery'],
    },
  ];

  it.each(DISHES)('$label', (fixture) => {
    const meal = {
      addedAllergens: [] as string[],
      customAllergens: [] as string[],
      storage: null,
      ...fixture,
    };
    const result = repriseDish(meal, INDEX);
    const state = allergenStateOf(
      stampLines(result.lines, BY_ID),
      result.addedAllergens,
      meal.customAllergens,
    );
    expect(state.allergens).toEqual(expect.arrayContaining(meal.allergens));
    expect(missingAllergens(meal.allergens, state.allergens)).toEqual([]);
  });
});
