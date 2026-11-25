import { BadRequestException } from '@nestjs/common';

import { ApiValidationPipe } from '../../../common/validation.pipe';
import { ChefIngredientDto, UpdateChefIngredientDto } from './chef-ingredient.dto';
import { MergeIngredientDto } from './merge-ingredient.dto';

// The options of main.ts: a body is checked exactly as the API checks it.
const pipe = new ApiValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const body = (metatype: new () => object, value: unknown) =>
  pipe.transform(value, { type: 'body', metatype });

const valid = (over: Record<string, unknown> = {}) => ({
  name: 'Harissa maison',
  aisle: 'epices',
  allergens: ['mustard'],
  ...over,
});

describe('ChefIngredientDto (Recettes §7.1)', () => {
  it('accepts a full entry, with allergens or with "none"', async () => {
    await expect(body(ChefIngredientDto, valid())).resolves.toBeDefined();
    await expect(
      body(
        ChefIngredientDto,
        valid({ allergens: undefined, allergensNone: true, aliases: ['harissa'] }),
      ),
    ).resolves.toBeDefined();
  });

  it('collapses the whitespace of a name', async () => {
    const dto = (await body(
      ChefIngredientDto,
      valid({ name: '  Harissa \n  maison ' }),
    )) as ChefIngredientDto;
    expect(dto.name).toBe('Harissa maison');
  });

  it.each([
    ['no name', { name: undefined }],
    ['an empty name', { name: '   ' }],
    ['a 121-character name', { name: 'a'.repeat(121) }],
    ['no aisle', { aisle: undefined }],
    ['an empty aisle', { aisle: '' }],
    ['an unknown allergen', { allergens: ['kryptonite'] }],
    ['a duplicate allergen', { allergens: ['gluten', 'gluten'] }],
    ['allergens that are not a list', { allergens: 'gluten' }],
    ['21 other names', { aliases: Array.from({ length: 21 }, (_, i) => `n${i}`) }],
    ['an unknown diet', { diets: ['carnivore'] }],
    ['month 13', { seasonMonths: [13] }],
    ['a duplicate month', { seasonMonths: [6, 6] }],
    // A chef never sets what Lab's Food owns.
    ['a status', { status: 'active' }],
    ['a chef profile', { chefProfileId: 'x' }],
    ['a review date', { reviewedAt: '2026-11-01' }],
  ])('refuses %s with 400', async (_label, over) => {
    await expect(body(ChefIngredientDto, valid(over))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('UpdateChefIngredientDto (Recettes §7.1)', () => {
  it('accepts any part of an entry, and nothing else', async () => {
    await expect(body(UpdateChefIngredientDto, {})).resolves.toBeDefined();
    await expect(
      body(UpdateChefIngredientDto, { name: 'Harissa', allergensNone: true }),
    ).resolves.toBeDefined();
  });

  it.each([
    ['a status', { status: 'inactive' }],
    ['an empty name', { name: '' }],
    ['an unknown allergen', { allergens: ['kryptonite'] }],
    ['an unknown field', { price: 3 }],
  ])('refuses %s with 400', async (_label, over) => {
    await expect(body(UpdateChefIngredientDto, over)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('MergeIngredientDto (Recettes §7.2)', () => {
  it('accepts a UUID', async () => {
    await expect(
      body(MergeIngredientDto, { intoId: '0d7c1c7a-3f5b-4d8e-9a1c-2b4e6f8a0c11' }),
    ).resolves.toBeDefined();
  });

  it.each([
    ['no target', {}],
    ['a target that is not a UUID', { intoId: '1 OR 1=1' }],
    ['a target that is not text', { intoId: 42 }],
    ['an unknown field', { intoId: '0d7c1c7a-3f5b-4d8e-9a1c-2b4e6f8a0c11', x: 1 }],
  ])('refuses %s with 400', async (_label, value) => {
    await expect(body(MergeIngredientDto, value)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
