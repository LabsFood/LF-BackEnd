import { BadRequestException } from '@nestjs/common';

import { ApiValidationPipe } from '../../../common/validation.pipe';
import {
  CatalogIngredientDto,
  ListCatalogIngredientsQueryDto,
  UpdateCatalogIngredientDto,
} from './ingredient.dto';

const pipe = new ApiValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const body = (metatype: new () => object, value: unknown) =>
  pipe.transform(value, { type: 'body', metatype });

const valid = (over: Record<string, unknown> = {}) => ({
  name: 'Tomate',
  aliases: ['pomme d’amour'],
  seasonMonths: [6, 7],
  aisle: 'fruits-legumes',
  allergens: ['gluten'],
  isBasic: false,
  ...over,
});

describe('CatalogIngredientDto (Recettes §4.10 / §5.1)', () => {
  it('accepts a full entry and 20 other names', async () => {
    await expect(body(CatalogIngredientDto, valid())).resolves.toBeDefined();
    const aliases = Array.from({ length: 20 }, (_, i) => `nom ${i}`);
    await expect(body(CatalogIngredientDto, valid({ aliases }))).resolves.toBeDefined();
  });

  it.each([
    ['21 other names', { aliases: Array.from({ length: 21 }, (_, i) => `n${i}`) }],
    ['an unknown allergen', { allergens: ['kryptonite'] }],
    ['a duplicate allergen', { allergens: ['gluten', 'gluten'] }],
    ['month 13', { seasonMonths: [13] }],
    ['month 0', { seasonMonths: [0] }],
    ['a duplicate month', { seasonMonths: [6, 6] }],
    ['an empty name', { name: '   ' }],
    ['a 121-character name', { name: 'a'.repeat(121) }],
    ['a 121-character alias', { aliases: ['a'.repeat(121)] }],
    ['an unknown diet', { diets: ['carnivore'] }],
    ['a non-boolean basic', { isBasic: 'yes' }],
    ['an unknown field', { price: 3 }],
  ])('refuses %s with 400', async (_label, over) => {
    await expect(body(CatalogIngredientDto, valid(over))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('UpdateCatalogIngredientDto', () => {
  it('accepts active and inactive, refuses the system statuses', async () => {
    await expect(
      body(UpdateCatalogIngredientDto, { status: 'inactive' }),
    ).resolves.toBeDefined();
    for (const status of ['pending', 'merged', 'nope']) {
      await expect(body(UpdateCatalogIngredientDto, { status })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
  });
});

describe('ListCatalogIngredientsQueryDto', () => {
  const query = (value: unknown) =>
    pipe.transform(value, { type: 'query', metatype: ListCatalogIngredientsQueryDto });

  it('reads the filters, "false" staying false', async () => {
    const parsed = (await query({
      status: 'pending',
      incomplete: 'true',
      reviewed: 'false',
    })) as ListCatalogIngredientsQueryDto;
    expect(parsed).toMatchObject({
      status: 'pending',
      incomplete: true,
      reviewed: false,
    });
  });

  it('refuses an unknown status or a non-boolean flag', async () => {
    await expect(query({ status: 'deleted' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(query({ incomplete: 'maybe' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
