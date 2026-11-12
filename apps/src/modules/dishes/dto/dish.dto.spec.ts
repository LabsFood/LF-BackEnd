import { BadRequestException } from '@nestjs/common';

import { ApiValidationPipe } from '../../../common/validation.pipe';
import {
  ConfirmAllergensDto,
  CreateDishDto,
  StorageDto,
  UpdateDishDto,
} from './dish.dto';

const pipe = new ApiValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const line = {
  name: 'Poulet fermier entier',
  qty: 1.4,
  unit: 'kg',
  aisle: 'boucherie',
};

const valid = (over: Record<string, unknown> = {}) => ({
  name: 'Poulet rôti',
  prepMinutes: 20,
  addedAllergens: ['celery'],
  recipe: {
    ingredients: [
      {
        ...line,
        optional: false,
        precision: 'bio',
        preparation: 'en morceaux',
        group: 'Base',
        hiddenFromClient: false,
        rawText: null,
      },
      { name: 'Sel', qty: null, unit: 'to_taste' },
    ],
    steps: [{ text: 'Rôtir.', type: 'cuisson' }],
    storage: {
      method: 'fridge',
      days: 3,
      freezable: true,
      freezerMonths: 3,
      thawing: 'Au frigo',
    },
  },
  ...over,
});

const withLine = (over: Record<string, unknown>) =>
  valid({
    recipe: { ingredients: [{ ...line, ...over }], steps: [] },
  });

async function check(body: unknown, metatype: new () => object = CreateDishDto) {
  return pipe.transform(body, { type: 'body', metatype });
}

async function refusal(body: unknown, metatype: new () => object = CreateDishDto) {
  const error = await check(body, metatype).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(BadRequestException);
  return JSON.stringify((error as BadRequestException).getResponse());
}

describe('dish wire format', () => {
  it('accepts a complete valid body', async () => {
    await expect(check(valid())).resolves.toBeInstanceOf(CreateDishDto);
  });

  it('accepts lockVersion on an update only', async () => {
    await expect(check({ lockVersion: 2 }, UpdateDishDto)).resolves.toBeDefined();
    expect(await refusal(valid({ lockVersion: 2 }))).toContain('lockVersion');
  });

  it.each([
    ['allergens', { allergens: ['celery'] }],
    ['allergensNone', { allergensNone: true }],
  ])('refuses %s', async (field, extra) => {
    expect(await refusal(valid(extra))).toContain(field);
  });

  it.each([
    ['unit', withLine({ unit: 'gousse' })],
    ['qty', withLine({ qty: 0 })],
    ['qty', withLine({ qty: 100001 })],
    ['qty', withLine({ qty: 1.0001 })],
    ['precision', withLine({ precision: 'x'.repeat(61) })],
    ['preparation', withLine({ preparation: 'x'.repeat(121) })],
    ['group', withLine({ group: 'x'.repeat(61) })],
    ['rawText', withLine({ rawText: 'x'.repeat(201) })],
    ['mystery', withLine({ mystery: 1 })],
  ])('refuses a bad line field: %s', async (field, body) => {
    expect(await refusal(body)).toContain(field);
  });

  it('names the field of a bad addedAllergens', async () => {
    expect(await refusal(valid({ addedAllergens: ['dairy'] }))).toContain(
      'addedAllergens',
    );
    expect(await refusal(valid({ addedAllergens: ['milk', 'milk'] }))).toContain(
      'addedAllergens',
    );
  });

  it('refuses a negative lockVersion', async () => {
    expect(await refusal({ lockVersion: -1 }, UpdateDishDto)).toContain('lockVersion');
  });

  it.each([
    ['freezerMonths', { freezerMonths: 25 }],
    ['freezerMonths', { freezerMonths: 0 }],
    ['thawing', { thawing: 'x'.repeat(301) }],
  ])('refuses a bad storage field: %s', async (field, over) => {
    const body = valid({
      recipe: {
        ingredients: [],
        steps: [],
        storage: { method: 'fridge', days: 3, ...over },
      },
    });
    expect(await refusal(body)).toContain(field);
  });

  it('lets null through on qty and unit (the save rules decide)', async () => {
    await expect(check(withLine({ qty: null, unit: null }))).resolves.toBeDefined();
  });

  it('trims line texts and strips control characters', async () => {
    const dto = (await check(
      withLine({ name: ' Poulet\u0007 ', precision: 'Bio\u0007 ', group: '  Base ' }),
    )) as CreateDishDto;
    const first = dto.recipe!.ingredients[0];
    expect(first.precision).toBe('Bio');
    expect(first.name).toBe('Poulet');
    expect(first.group).toBe('Base');
  });
});

describe('allergen confirmation body (ruling R8)', () => {
  it('is optional: no body, an empty one or a lockVersion', async () => {
    await expect(check(undefined, ConfirmAllergensDto)).resolves.toEqual({});
    await expect(check({}, ConfirmAllergensDto)).resolves.toBeDefined();
    await expect(check({ lockVersion: 0 }, ConfirmAllergensDto)).resolves.toEqual({
      lockVersion: 0,
    });
  });

  it.each([
    ['a negative lockVersion', { lockVersion: -1 }, 'lockVersion'],
    ['a decimal lockVersion', { lockVersion: 1.5 }, 'lockVersion'],
    ['a lockVersion as text', { lockVersion: '4' }, 'lockVersion'],
    ['an unknown field', { allergens: ['milk'] }, 'allergens'],
  ])('refuses %s', async (_case, body, field) => {
    expect(await refusal(body, ConfirmAllergensDto)).toContain(field);
  });
});

// Recettes §5.3: omitted, `freezable` is unanswered (readiness asks it), not false.
describe('StorageDto.freezable in Swagger', () => {
  it('documents no default', () => {
    // The key @nestjs/swagger stores a property's @ApiProperty options under.
    const meta = Reflect.getMetadata(
      'swagger/apiModelProperties',
      StorageDto.prototype,
      'freezable',
    ) as Record<string, unknown>;
    expect(meta).toBeDefined();
    expect(meta).not.toHaveProperty('default');
    expect(String(meta.description)).toContain('unanswered');
  });
});
