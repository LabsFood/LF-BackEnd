import { checkBody, refusalOf } from '../../../common/dto/pipe.test-helpers';
import {
  ConfirmAllergensDto,
  CreateDishDto,
  RestoreVersionDto,
  UpdateDishDto,
} from './dish.dto';

/**
 * Task 20A: with the global `enableImplicitConversion`, "false" would be `true`, an
 * object would be "[object Object]" and "3" would be 3. The recipe fields keep what
 * the caller sent, so each of these is a 400.
 */
const valid = () => ({
  name: 'Poulet rôti',
  description: 'Rôti',
  country: 'FR',
  category: 'main',
  portions: 4,
  prepMinutes: 20,
  cookMinutes: 55,
  diets: ['lactose-free'],
  customDiets: ['sans gluten maison'],
  addedAllergens: ['celery'],
  customAllergens: ['sarrasin'],
  equipment: ['Cocotte'],
  declaredDiets: ['halal'],
  profiles: ['budget'],
  personalTags: ['été'],
  seasonsOverride: [6, 7],
  recipe: {
    ingredients: [
      {
        name: 'Poulet',
        qty: 1.4,
        unit: 'kg',
        aisle: 'boucherie',
        link: 'https://www.example.com/poulet',
        toVerify: false,
        fixedQuantity: false,
        optional: false,
        hiddenFromClient: false,
        precision: 'bio',
        preparation: 'en morceaux',
        group: 'Base',
        rawText: null,
        catalogIngredientId: '0d7c1c7a-3f5b-4d8e-9a1c-2b4e6f8a0c11',
      },
    ],
    steps: [{ text: 'Rôtir.', type: 'cuisson', durationMinutes: 55 }],
    reheating: {
      modes: ['oven'],
      mode: 'oven',
      temperature: 160,
      minutes: 15,
      note: 'Couvrir',
      container: 'Plat',
    },
    storage: {
      method: 'fridge',
      days: 3,
      container: 'Boîte',
      freezable: true,
      freezerMonths: 3,
      thawing: 'Au frigo',
    },
  },
});

type Body = ReturnType<typeof valid>;
type Edit = (body: Body, value: unknown) => void;

const line =
  (key: string): Edit =>
  (b, v) => {
    (b.recipe.ingredients[0] as Record<string, unknown>)[key] = v;
  };
const storage =
  (key: string): Edit =>
  (b, v) => {
    (b.recipe.storage as Record<string, unknown>)[key] = v;
  };
const reheating =
  (key: string): Edit =>
  (b, v) => {
    (b.recipe.reheating as Record<string, unknown>)[key] = v;
  };
const step =
  (key: string): Edit =>
  (b, v) => {
    (b.recipe.steps[0] as Record<string, unknown>)[key] = v;
  };
const top =
  (key: string): Edit =>
  (b, v) => {
    (b as Record<string, unknown>)[key] = v;
  };

const BAD_BOOLEANS = ['false', 'true', 'yes', 1, 0, {}];
const BAD_STRINGS = [{}, 123, true, []];
const BAD_NUMBERS = ['3', '0', true];
const BAD_LISTS = ['milk', { 0: 'milk' }, [1], [{}]];

const cases: [string, Edit, unknown[]][] = [
  ['optional', line('optional'), BAD_BOOLEANS],
  ['hiddenFromClient', line('hiddenFromClient'), BAD_BOOLEANS],
  ['toVerify', line('toVerify'), BAD_BOOLEANS],
  ['fixedQuantity', line('fixedQuantity'), BAD_BOOLEANS],
  ['name', line('name'), BAD_STRINGS],
  ['precision', line('precision'), BAD_STRINGS],
  ['preparation', line('preparation'), BAD_STRINGS],
  ['group', line('group'), BAD_STRINGS],
  ['rawText', line('rawText'), BAD_STRINGS],
  ['aisle', line('aisle'), BAD_STRINGS],
  ['unit', line('unit'), BAD_STRINGS],
  ['link', line('link'), BAD_STRINGS],
  ['catalogIngredientId', line('catalogIngredientId'), BAD_STRINGS],
  ['qty', line('qty'), BAD_NUMBERS],
  ['text', step('text'), BAD_STRINGS],
  ['durationMinutes', step('durationMinutes'), BAD_NUMBERS],
  ['freezable', storage('freezable'), BAD_BOOLEANS],
  ['method', storage('method'), BAD_STRINGS],
  ['thawing', storage('thawing'), BAD_STRINGS],
  ['container', storage('container'), BAD_STRINGS],
  ['days', storage('days'), BAD_NUMBERS],
  ['freezerMonths', storage('freezerMonths'), BAD_NUMBERS],
  ['note', reheating('note'), BAD_STRINGS],
  ['container', reheating('container'), BAD_STRINGS],
  ['temperature', reheating('temperature'), BAD_NUMBERS],
  ['minutes', reheating('minutes'), BAD_NUMBERS],
  ['name', top('name'), BAD_STRINGS],
  ['description', top('description'), BAD_STRINGS],
  ['country', top('country'), BAD_STRINGS],
  ['category', top('category'), BAD_STRINGS],
  ['portions', top('portions'), BAD_NUMBERS],
  ['prepMinutes', top('prepMinutes'), BAD_NUMBERS],
  ['cookMinutes', top('cookMinutes'), BAD_NUMBERS],
  ['addedAllergens', top('addedAllergens'), BAD_LISTS],
  ['customAllergens', top('customAllergens'), BAD_LISTS],
  ['profiles', top('profiles'), BAD_LISTS],
  ['personalTags', top('personalTags'), BAD_LISTS],
  ['equipment', top('equipment'), BAD_LISTS],
  ['declaredDiets', top('declaredDiets'), BAD_LISTS],
  ['diets', top('diets'), BAD_LISTS],
  ['customDiets', top('customDiets'), BAD_LISTS],
  ['seasonsOverride', top('seasonsOverride'), ['6', ['6'], 6, [true]]],
];

describe('dish fields keep the raw value (Task 20A)', () => {
  it('still accepts a complete valid body', async () => {
    await expect(checkBody(valid(), CreateDishDto)).resolves.toBeInstanceOf(
      CreateDishDto,
    );
  });

  it('keeps the one-line cleaning on the lines', async () => {
    const body = valid();
    body.recipe.ingredients[0].name = '  Poulet   fermier ';
    const out = (await checkBody(body, CreateDishDto)) as CreateDishDto;
    expect(out.recipe?.ingredients[0].name).toBe('Poulet fermier');
  });

  it.each(
    cases.flatMap(([field, edit, values]) =>
      values.map((v) => [field, edit, v] as const),
    ),
  )('refuses %s = %j', async (field, edit, value) => {
    const body = valid();
    edit(body, value);
    expect(await refusalOf(body, CreateDishDto)).toContain(field);
  });

  it('applies to an update too', async () => {
    expect(await refusalOf({ name: 123 }, UpdateDishDto)).toContain('name');
    expect(await refusalOf({ addedAllergens: 'milk' }, UpdateDishDto)).toContain(
      'addedAllergens',
    );
    expect(await refusalOf({ lockVersion: '3' }, UpdateDishDto)).toContain('lockVersion');
    await expect(
      checkBody({ lockVersion: 3, name: 'x' }, UpdateDishDto),
    ).resolves.toBeDefined();
  });

  it.each([ConfirmAllergensDto, RestoreVersionDto])(
    '%p: lockVersion must be a JSON number',
    async (dto) => {
      expect(await refusalOf({ lockVersion: '3' }, dto)).toContain('lockVersion');
      expect(await refusalOf({ lockVersion: {} }, dto)).toContain('lockVersion');
      await expect(checkBody({ lockVersion: 3 }, dto)).resolves.toBeDefined();
      await expect(checkBody({}, dto)).resolves.toBeDefined();
    },
  );

  it('treats a missing body as an empty one for the optional bodies', async () => {
    await expect(checkBody(undefined, RestoreVersionDto)).resolves.toBeDefined();
    await expect(checkBody(undefined, ConfirmAllergensDto)).resolves.toBeDefined();
  });
});
