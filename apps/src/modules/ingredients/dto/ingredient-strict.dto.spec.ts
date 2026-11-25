import { checkBody, refusalOf } from '../../../common/dto/pipe.test-helpers';
import { ChefIngredientDto, UpdateChefIngredientDto } from './chef-ingredient.dto';
import { CatalogIngredientDto, UpdateCatalogIngredientDto } from './ingredient.dto';
import { ImportIngredientsDto } from './import-ingredients.dto';
import { MergeIngredientDto } from './merge-ingredient.dto';

/** Task 20A: ingredient bodies keep the raw value. */
const valid = (): Record<string, unknown> => ({
  name: 'Tomate',
  aliases: ['pomme d’amour'],
  aisle: 'fruits-legumes',
  allergens: ['gluten'],
  allergensNone: false,
  isBasic: false,
  diets: ['vegan'],
  seasonMonths: [6, 7],
});

const cases: [string, unknown][] = [
  ['name', {}],
  ['name', 123],
  ['aisle', {}],
  ['aisle', 5],
  ['aliases', 'pomme'],
  ['aliases', [1]],
  ['allergens', 'gluten'],
  ['allergens', [{}]],
  ['diets', 'vegan'],
  ['seasonMonths', '6'],
  ['seasonMonths', ['6']],
  ['allergensNone', 'false'],
  ['allergensNone', 'true'],
  ['isBasic', 'false'],
  ['isBasic', 1],
];

describe.each([
  ['CatalogIngredientDto', CatalogIngredientDto],
  ['ChefIngredientDto', ChefIngredientDto],
  ['UpdateChefIngredientDto', UpdateChefIngredientDto],
])('%s keeps the raw value (Task 20A)', (_name, dto) => {
  it('accepts a correct body', async () => {
    await expect(checkBody(valid(), dto)).resolves.toBeInstanceOf(dto);
  });

  it.each(cases)('refuses %s = %j', async (field, value) => {
    expect(await refusalOf({ ...valid(), [field]: value }, dto)).toContain(field);
  });
});

describe('UpdateCatalogIngredientDto (Task 20A)', () => {
  it('refuses a non-string status and a string boolean', async () => {
    expect(await refusalOf({ status: {} }, UpdateCatalogIngredientDto)).toContain(
      'status',
    );
    expect(await refusalOf({ status: 1 }, UpdateCatalogIngredientDto)).toContain(
      'status',
    );
    expect(await refusalOf({ isBasic: 'false' }, UpdateCatalogIngredientDto)).toContain(
      'isBasic',
    );
    await expect(
      checkBody({ status: 'inactive' }, UpdateCatalogIngredientDto),
    ).resolves.toBeDefined();
  });
});

// I4: `@IsOptional()` let `null` through, and the service then failed on it (500).
// No ingredient field is cleared by null: lists clear with [], booleans with false,
// and an aisle is never cleared. So null is refused (400), field by field.
describe('null on an ingredient field is refused, never a 500 (I4)', () => {
  const FIELDS = [
    'name',
    'aliases',
    'aisle',
    'allergens',
    'allergensNone',
    'isBasic',
    'diets',
    'seasonMonths',
  ];

  describe.each([
    ['CatalogIngredientDto', CatalogIngredientDto],
    ['ChefIngredientDto', ChefIngredientDto],
  ])('%s', (_name, dto) => {
    it.each(FIELDS)('refuses %s = null', async (field) => {
      expect(await refusalOf({ ...valid(), [field]: null }, dto)).toContain(field);
    });
  });

  describe.each([
    ['UpdateCatalogIngredientDto', UpdateCatalogIngredientDto],
    ['UpdateChefIngredientDto', UpdateChefIngredientDto],
  ])('%s', (_name, dto) => {
    it.each(FIELDS)('refuses %s = null, alone', async (field) => {
      expect(await refusalOf({ [field]: null }, dto)).toContain(field);
    });

    it('still takes any one field alone, and an empty body', async () => {
      await expect(checkBody({ isBasic: true }, dto)).resolves.toBeInstanceOf(dto);
      await expect(checkBody({}, dto)).resolves.toBeInstanceOf(dto);
    });
  });

  it('refuses status = null on the admin update', async () => {
    expect(await refusalOf({ status: null }, UpdateCatalogIngredientDto)).toContain(
      'status',
    );
  });

  it('refuses confirm = null on the import', async () => {
    expect(
      await refusalOf({ csv: 'nom', confirm: null }, ImportIngredientsDto),
    ).toContain('confirm');
  });
});

// M4: `normalizeName` spells œ and æ out, so a name of 120 can need 121 in the stored
// key (`normalized_name VARCHAR(120)`): refused with 400, never a 500 from Postgres.
describe('a name too long once spelled out is refused (M4)', () => {
  const LONG = `${'a'.repeat(119)}œ`;

  describe.each([
    ['CatalogIngredientDto', CatalogIngredientDto],
    ['ChefIngredientDto', ChefIngredientDto],
    ['UpdateCatalogIngredientDto', UpdateCatalogIngredientDto],
    ['UpdateChefIngredientDto', UpdateChefIngredientDto],
  ])('%s', (_name, dto) => {
    it('refuses 119 letters and an œ, naming the field and the reason', async () => {
      const refusal = await refusalOf({ ...valid(), name: LONG }, dto);
      expect(refusal).toContain('"field":"name"');
      expect(refusal).toContain('120');
    });

    it('accepts 118 letters and an œ, and 120 plain letters', async () => {
      await expect(
        checkBody({ ...valid(), name: `${'a'.repeat(118)}œ` }, dto),
      ).resolves.toBeInstanceOf(dto);
      await expect(
        checkBody({ ...valid(), name: 'a'.repeat(120) }, dto),
      ).resolves.toBeInstanceOf(dto);
    });
  });
});

describe('ImportIngredientsDto (Task 20A)', () => {
  it.each([12, {}, ['nom'], true])('refuses csv = %j', async (csv) => {
    expect(await refusalOf({ csv }, ImportIngredientsDto)).toContain('csv');
  });
  it('refuses a string confirm', async () => {
    expect(
      await refusalOf({ csv: 'nom', confirm: 'false' }, ImportIngredientsDto),
    ).toContain('confirm');
  });
});

describe('MergeIngredientDto (Task 20A)', () => {
  it.each([{}, 12, ['0d7c1c7a-3f5b-4d8e-9a1c-2b4e6f8a0c11'], 'nope'])(
    'refuses intoId = %j',
    async (intoId) => {
      expect(await refusalOf({ intoId }, MergeIngredientDto)).toContain('intoId');
    },
  );
  it('accepts a uuid', async () => {
    await expect(
      checkBody({ intoId: '0d7c1c7a-3f5b-4d8e-9a1c-2b4e6f8a0c11' }, MergeIngredientDto),
    ).resolves.toBeDefined();
  });
});
