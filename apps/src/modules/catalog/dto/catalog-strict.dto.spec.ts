import { checkBody, refusalOf } from '../../../common/dto/pipe.test-helpers';
import { CreateMealDto, UpdateMealDto } from './catalog-admin.dto';

/** Task 20A: the Lab's Food meal keeps the raw value, like the chef's dish. */
type Body = Record<string, unknown>;

const valid = (): Body => ({
  name: 'Poulet yassa',
  description: 'Mariné',
  prepTime: 45,
  cookTime: 30,
  portions: 4,
  calories: 600,
  category: 'main',
  country: 'SN',
  continent: 'africa',
  difficulty: 'easy',
  imageUrl: 'https://www.example.com/a.jpg',
  isFeatured: false,
  status: 'draft',
  dietaryTags: ['vegan'],
  customDiets: ['maison'],
  addedAllergens: ['celery'],
  customAllergens: ['sarrasin'],
  declaredDiets: ['halal'],
  profiles: ['budget'],
  equipment: ['Cocotte'],
  seasonsOverride: [6],
  ingredients: [
    { name: 'Poulet', qty: 1, unit: 'kg', aisle: 'boucherie', optional: false },
  ],
  steps: [{ text: 'Rôtir.' }],
  storage: { method: 'fridge', days: 3, freezable: true },
  reheating: { note: 'Couvrir', temperature: 160 },
});

const BAD_STRINGS = [{}, 123, true, []];
const BAD_NUMBERS = ['3', true];
const BAD_LISTS = ['milk', [1], [{}]];

const set =
  (key: string) =>
  (b: Body, v: unknown): void => {
    b[key] = v;
  };
const nested =
  (parent: string, key: string, index?: number) =>
  (b: Body, v: unknown): void => {
    const holder = b[parent] as Body | Body[];
    (index === undefined ? (holder as Body) : (holder as Body[])[index])[key] = v;
  };

const cases: [string, (b: Body, v: unknown) => void, unknown[]][] = [
  ['name', set('name'), BAD_STRINGS],
  ['description', set('description'), BAD_STRINGS],
  ['category', set('category'), BAD_STRINGS],
  ['country', set('country'), BAD_STRINGS],
  ['continent', set('continent'), BAD_STRINGS],
  ['difficulty', set('difficulty'), BAD_STRINGS],
  ['imageUrl', set('imageUrl'), BAD_STRINGS],
  ['status', set('status'), BAD_STRINGS],
  ['isFeatured', set('isFeatured'), ['false', 'true', 1, {}]],
  ['prepTime', set('prepTime'), BAD_NUMBERS],
  ['cookTime', set('cookTime'), BAD_NUMBERS],
  ['portions', set('portions'), BAD_NUMBERS],
  ['calories', set('calories'), BAD_NUMBERS],
  ['dietaryTags', set('dietaryTags'), BAD_LISTS],
  ['customDiets', set('customDiets'), BAD_LISTS],
  ['addedAllergens', set('addedAllergens'), BAD_LISTS],
  ['customAllergens', set('customAllergens'), BAD_LISTS],
  ['declaredDiets', set('declaredDiets'), BAD_LISTS],
  ['profiles', set('profiles'), BAD_LISTS],
  ['equipment', set('equipment'), BAD_LISTS],
  ['seasonsOverride', set('seasonsOverride'), ['6', ['6']]],
  ['optional', nested('ingredients', 'optional', 0), ['false', 'true']],
  ['qty', nested('ingredients', 'qty', 0), ['1']],
  ['text', nested('steps', 'text', 0), BAD_STRINGS],
  ['days', nested('storage', 'days'), ['3']],
  ['freezable', nested('storage', 'freezable'), ['false']],
  ['temperature', nested('reheating', 'temperature'), ['160']],
  ['note', nested('reheating', 'note'), BAD_STRINGS],
];

describe('meal fields keep the raw value (Task 20A)', () => {
  it('still accepts a complete valid body', async () => {
    await expect(checkBody(valid(), CreateMealDto)).resolves.toBeInstanceOf(
      CreateMealDto,
    );
  });

  it.each(
    cases.flatMap(([field, edit, values]) =>
      values.map((v) => [field, edit, v] as const),
    ),
  )('refuses %s = %j', async (field, edit, value) => {
    const body = valid();
    edit(body, value);
    expect(await refusalOf(body, CreateMealDto)).toContain(field);
  });

  it('applies to an update too', async () => {
    expect(await refusalOf({ isFeatured: 'false' }, UpdateMealDto)).toContain(
      'isFeatured',
    );
    expect(await refusalOf({ prepTime: '3' }, UpdateMealDto)).toContain('prepTime');
    await expect(checkBody({ isFeatured: false }, UpdateMealDto)).resolves.toBeDefined();
  });
});

// Ruling R30: an admin update may send the lockVersion it read; a create never does.
describe('UpdateMealDto.lockVersion (ruling R30)', () => {
  it('accepts a whole number from 0, and its absence', async () => {
    await expect(
      checkBody({ name: 'Yassa', lockVersion: 0 }, UpdateMealDto),
    ).resolves.toMatchObject({ lockVersion: 0 });
    await expect(
      checkBody({ name: 'Yassa', lockVersion: 7 }, UpdateMealDto),
    ).resolves.toMatchObject({ lockVersion: 7 });
    await expect(checkBody({ name: 'Yassa' }, UpdateMealDto)).resolves.toBeDefined();
  });

  it.each([['4'], [-1], [1.5], [true], [{}]])(
    'refuses lockVersion = %j',
    async (value) => {
      expect(await refusalOf({ lockVersion: value }, UpdateMealDto)).toContain(
        'lockVersion',
      );
    },
  );

  it('is not part of a create', async () => {
    expect(await refusalOf({ ...valid(), lockVersion: 0 }, CreateMealDto)).toContain(
      'lockVersion',
    );
  });
});
