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
